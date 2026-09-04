/// Jalin governor - the on-chain registry that owns every router parameter, and
/// a stateful anonymizer helper in its own right.
///
/// Ballots are cast through `privacy_invoke`, which means the weight of a vote is
/// public while the voter is not. A ballot escrows its stake until the proposal
/// closes, which is what stops the same funds voting twice; the stake is redeemed
/// afterwards by revealing a secret, following the escrow pattern in the STRK20
/// documentation.
#[starknet::contract]
pub mod JalinGovernor {
    use core::num::traits::Zero;
    use core::poseidon::poseidon_hash_span;
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::{
        ContractAddress, get_block_number, get_caller_address, get_contract_address,
    };
    use crate::interfaces::{
        IErc20Dispatcher, IErc20DispatcherTrait, IJalinGovernance, IJalinGovernor,
    };
    use crate::types::{
        Ballot, OpenNoteDeposit, Proposal, RouterParams, gov_errors as errors, kinds, ops,
    };

    /// Domain separator for ballot commitments.
    pub const BALLOT_TAG: felt252 = 'JALIN_BALLOT:V1';

    #[storage]
    struct Storage {
        params: RouterParams,
        denied: Map<ContractAddress, bool>,
        labels: Map<ContractAddress, felt252>,
        /// The STRK20 pool. The only address allowed to deliver a ballot.
        pool: ContractAddress,
        /// The token a ballot must be denominated in.
        ballot_token: ContractAddress,
        voting_blocks: u64,
        timelock_blocks: u64,
        quorum: u128,
        proposal_count: u64,
        proposals: Map<u64, Proposal>,
        ballots: Map<felt252, Ballot>,
        /// Stake escrowed by ballots that have been cast and not yet redeemed.
        /// Every tallied vote is backed by tokens this contract really holds; see
        /// `cast`.
        outstanding: u128,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        Proposed: Proposed,
        BallotCast: BallotCast,
        BallotRedeemed: BallotRedeemed,
        Executed: Executed,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Proposed {
        #[key]
        pub proposal_id: u64,
        pub kind: u8,
        pub end_block: u64,
        pub eta: u64,
    }

    /// Carries the weight but never the voter: the pool paid this contract, and
    /// who funded that payment is not knowable from here.
    #[derive(Drop, starknet::Event)]
    pub struct BallotCast {
        #[key]
        pub proposal_id: u64,
        pub support: u8,
        pub weight: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct BallotRedeemed {
        #[key]
        pub proposal_id: u64,
        pub weight: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Executed {
        #[key]
        pub proposal_id: u64,
        pub kind: u8,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        pool: ContractAddress,
        ballot_token: ContractAddress,
        fee_recipient: ContractAddress,
        max_steps: u32,
        max_calldata: u32,
        voting_blocks: u64,
        timelock_blocks: u64,
        quorum: u128,
    ) {
        assert(pool.is_non_zero(), errors::ZERO_POOL);
        assert(ballot_token.is_non_zero(), errors::ZERO_BALLOT_TOKEN);
        assert(max_steps.is_non_zero(), errors::ZERO_LIMIT);
        assert(max_calldata.is_non_zero(), errors::ZERO_LIMIT);
        self.pool.write(pool);
        self.ballot_token.write(ballot_token);
        self.voting_blocks.write(voting_blocks);
        self.timelock_blocks.write(timelock_blocks);
        self.quorum.write(quorum);
        self
            .params
            .write(
                RouterParams {
                    paused: false, max_steps, max_calldata, fee_bps: 0, fee_recipient,
                },
            );
    }

    /// Read side, consumed by the router on every plan.
    #[abi(embed_v0)]
    pub impl JalinGovernorImpl of IJalinGovernor<ContractState> {
        fn params(self: @ContractState) -> RouterParams {
            self.params.read()
        }

        fn is_denied(self: @ContractState, target: ContractAddress) -> bool {
            self.denied.read(target)
        }

        fn label_of(self: @ContractState, target: ContractAddress) -> felt252 {
            self.labels.read(target)
        }
    }

    #[abi(embed_v0)]
    pub impl JalinGovernanceImpl of IJalinGovernance<ContractState> {
        /// Permissionless. Spam is answered by quorum, not by a gate on who may
        /// speak - a gate would just move the admin key somewhere less visible.
        fn propose(
            ref self: ContractState,
            kind: u8,
            target: ContractAddress,
            value_a: felt252,
            value_b: felt252,
        ) -> u64 {
            assert(kind <= kinds::LABEL, errors::UNKNOWN_KIND);
            let now = get_block_number();
            let end_block = now + self.voting_blocks.read();
            let eta = end_block + self.timelock_blocks.read();
            let proposal_id = self.proposal_count.read() + 1;

            self.proposal_count.write(proposal_id);
            self
                .proposals
                .write(
                    proposal_id,
                    Proposal {
                        kind,
                        target,
                        value_a,
                        value_b,
                        end_block,
                        eta,
                        yes: 0,
                        no: 0,
                        executed: false,
                    },
                );
            self.emit(Proposed { proposal_id, kind, end_block, eta });
            proposal_id
        }

        /// Ballots arrive here, not through a public `vote` entry point.
        fn privacy_invoke(
            ref self: ContractState,
            pool_address: ContractAddress,
            operation: u8,
            proposal_id: u64,
            support: u8,
            commitment: felt252,
            secret: felt252,
            amount: u128,
            note_id: felt252,
        ) -> Span<OpenNoteDeposit> {
            let pool = self.pool.read();
            assert(pool_address == pool, errors::BAD_POOL);
            assert(get_caller_address() == pool, errors::CALLER_NOT_POOL);

            if operation == ops::CAST {
                self.cast(proposal_id, support, commitment, amount)
            } else if operation == ops::REDEEM {
                self.redeem(secret, note_id)
            } else {
                core::panic_with_felt252(errors::UNKNOWN_OP)
            }
        }

        /// Anyone may execute once the timelock has run out and the ballot carried.
        fn execute(ref self: ContractState, proposal_id: u64) {
            let proposal = self.proposals.read(proposal_id);
            assert(proposal.end_block.is_non_zero(), errors::NO_PROPOSAL);
            assert(!proposal.executed, errors::ALREADY_EXECUTED);
            assert(get_block_number() >= proposal.eta, errors::TIMELOCKED);
            assert(proposal.yes > proposal.no, errors::REJECTED);
            assert(proposal.yes >= self.quorum.read(), errors::NO_QUORUM);

            self.proposals.write(proposal_id, Proposal { executed: true, ..proposal });
            self.apply(proposal);
            self.emit(Executed { proposal_id, kind: proposal.kind });
        }

        fn get_proposal(self: @ContractState, proposal_id: u64) -> Proposal {
            self.proposals.read(proposal_id)
        }

        fn get_ballot(self: @ContractState, commitment: felt252) -> Ballot {
            self.ballots.read(commitment)
        }

        fn ballot_commitment(self: @ContractState, secret: felt252) -> felt252 {
            poseidon_hash_span([BALLOT_TAG, secret].span())
        }

        fn proposal_count(self: @ContractState) -> u64 {
            self.proposal_count.read()
        }

        fn outstanding(self: @ContractState) -> u128 {
            self.outstanding.read()
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn cast(
            ref self: ContractState,
            proposal_id: u64,
            support: u8,
            commitment: felt252,
            amount: u128,
        ) -> Span<OpenNoteDeposit> {
            assert(commitment.is_non_zero(), errors::ZERO_COMMITMENT);
            assert(amount.is_non_zero(), errors::ZERO_WEIGHT);
            assert(support <= 1, errors::BAD_SUPPORT);

            let proposal = self.proposals.read(proposal_id);
            assert(proposal.end_block.is_non_zero(), errors::NO_PROPOSAL);
            assert(get_block_number() <= proposal.end_block, errors::VOTING_CLOSED);

            let existing = self.ballots.read(commitment);
            assert(existing.proposal_id.is_zero(), errors::COMMITMENT_USED);

            // The weight has to be here. `amount` arrives on the pool's calldata,
            // and taking it on trust was this contract's one real defect: a ballot
            // could tally weight it never staked and then redeem it against other
            // voters' escrow. The pool's withdraw leg runs before the invoke, so
            // this ballot's own stake is already in the balance below;
            // `outstanding` is what earlier ballots hold and have not redeemed.
            // The router has always read `balance_of` rather than trusting a
            // caller's figure, and now both contracts do.
            let held = IErc20Dispatcher { contract_address: self.ballot_token.read() }
                .balance_of(get_contract_address());
            let outstanding = self.outstanding.read();
            let escrowed: u256 = outstanding.into() + amount.into();
            assert(held >= escrowed, errors::WEIGHT_NOT_ESCROWED);
            self.outstanding.write(outstanding + amount);

            let updated = if support == 1 {
                Proposal { yes: proposal.yes + amount, ..proposal }
            } else {
                Proposal { no: proposal.no + amount, ..proposal }
            };
            self.proposals.write(proposal_id, updated);
            self
                .ballots
                .write(commitment, Ballot { proposal_id, amount, claimed: false });

            self.emit(BallotCast { proposal_id, support, weight: amount });

            // Empty span: the stake stays escrowed here until the vote closes,
            // which is the whole reason one set of funds cannot vote twice.
            [].span()
        }

        fn redeem(
            ref self: ContractState, secret: felt252, note_id: felt252,
        ) -> Span<OpenNoteDeposit> {
            let commitment = poseidon_hash_span([BALLOT_TAG, secret].span());
            let ballot = self.ballots.read(commitment);
            assert(ballot.proposal_id.is_non_zero(), errors::NO_BALLOT);
            assert(!ballot.claimed, errors::ALREADY_CLAIMED);

            let proposal = self.proposals.read(ballot.proposal_id);
            assert(get_block_number() > proposal.end_block, errors::VOTING_OPEN);

            self.ballots.write(commitment, Ballot { claimed: true, ..ballot });
            // Leaves escrow, so it stops backing any future ballot's weight.
            self.outstanding.write(self.outstanding.read() - ballot.amount);

            let token = self.ballot_token.read();
            IErc20Dispatcher { contract_address: token }
                .approve(self.pool.read(), ballot.amount.into());

            self.emit(BallotRedeemed { proposal_id: ballot.proposal_id, weight: ballot.amount });

            [OpenNoteDeposit { note_id, token, amount: ballot.amount }].span()
        }

        fn apply(ref self: ContractState, proposal: Proposal) {
            let current = self.params.read();
            if proposal.kind == kinds::PAUSE {
                self.params.write(RouterParams { paused: proposal.value_a != 0, ..current });
            } else if proposal.kind == kinds::LIMITS {
                let max_steps: u32 = proposal.value_a.try_into().expect(errors::BAD_VALUE);
                let max_calldata: u32 = proposal.value_b.try_into().expect(errors::BAD_VALUE);
                assert(max_steps.is_non_zero(), errors::ZERO_LIMIT);
                assert(max_calldata.is_non_zero(), errors::ZERO_LIMIT);
                self.params.write(RouterParams { max_steps, max_calldata, ..current });
            } else if proposal.kind == kinds::FEE {
                let fee_bps: u16 = proposal.value_a.try_into().expect(errors::BAD_VALUE);
                assert(fee_bps <= 1000, errors::FEE_TOO_HIGH);
                self
                    .params
                    .write(RouterParams { fee_bps, fee_recipient: proposal.target, ..current });
            } else if proposal.kind == kinds::DENY {
                self.denied.write(proposal.target, proposal.value_a != 0);
            } else {
                self.labels.write(proposal.target, proposal.value_a);
            }
        }
    }
}
