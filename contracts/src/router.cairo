/// Jalin router - one anonymizer helper that executes an arbitrary multi-step,
/// multi-token plan inside a single `privacy_invoke`.
///
/// Targets and calldata are unrestricted. Safety comes from invariants enforced
/// here, not from a whitelist: the router is non-custodial and holds nothing
/// between transactions, so a hostile plan can only harm the notes of whoever
/// authored it. See docs/threat-model.md.
#[starknet::contract]
pub mod JalinRouter {
    use core::num::traits::Zero;
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::syscalls::call_contract_syscall;
    use starknet::{ContractAddress, SyscallResultTrait, get_caller_address, get_contract_address};
    use crate::interfaces::{
        IErc20Dispatcher, IErc20DispatcherTrait, IJalinGovernorDispatcher,
        IJalinGovernorDispatcherTrait, IJalinRouter,
    };
    use crate::types::{OpenNoteDeposit, Output, Step, errors};

    const BPS_DENOMINATOR: u256 = 10000;

    #[storage]
    struct Storage {
        governor: ContractAddress,
        plans_executed: u64,
        /// Reentrancy latch. Held for the duration of a sandwich so that a
        /// hostile token contract cannot call back in through `sweep`.
        locked: bool,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        PlanExecuted: PlanExecuted,
        Swept: Swept,
    }

    /// Deliberately carries no token, amount or note id. An observer already sees
    /// the public transfer legs of the pool, and this event must not add anything
    /// that helps link a plan back to the note that funded it.
    #[derive(Drop, starknet::Event)]
    pub struct PlanExecuted {
        #[key]
        pub plan_id: u64,
        pub step_count: u32,
        pub output_count: u32,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Swept {
        #[key]
        pub token: ContractAddress,
        pub amount: u256,
    }

    #[constructor]
    fn constructor(ref self: ContractState, governor: ContractAddress) {
        assert(governor.is_non_zero(), errors::ZERO_TARGET);
        self.governor.write(governor);
    }

    #[abi(embed_v0)]
    pub impl JalinRouterImpl of IJalinRouter<ContractState> {
        fn privacy_invoke(
            ref self: ContractState,
            pool_address: ContractAddress,
            steps: Array<Step>,
            outputs: Array<Output>,
        ) -> Span<OpenNoteDeposit> {
            // -- I1: the pool is the only legitimate caller ------------------
            assert(pool_address.is_non_zero(), errors::ZERO_POOL);
            assert(get_caller_address() == pool_address, errors::CALLER_NOT_POOL);

            let governor = IJalinGovernorDispatcher { contract_address: self.governor.read() };
            let params = governor.params();
            assert(!params.paused, errors::PAUSED);
            assert(steps.len() <= params.max_steps, errors::TOO_MANY_STEPS); // I6
            assert(outputs.len().is_non_zero(), errors::NO_OUTPUTS);

            self.locked.write(true);
            let self_addr = get_contract_address();

            // Every token any step is allowed to move. Checked for residue below.
            let mut touched: Array<ContractAddress> = array![];

            let mut i: u32 = 0;
            while i < steps.len() {
                let step = steps.at(i);
                let target = *step.target;

                // -- I2: no step may re-enter the sandwich -------------------
                assert(target.is_non_zero(), errors::ZERO_TARGET);
                assert(target != pool_address, errors::TARGET_IS_POOL);
                assert(target != self_addr, errors::TARGET_IS_SELF);
                assert((*step.selector).is_non_zero(), errors::ZERO_SELECTOR);
                assert(step.calldata.len() <= params.max_calldata, errors::CALLDATA_TOO_LONG);

                // Governance holds a deny list, never an allow list: the default
                // stays permissionless and the switch is only a circuit breaker.
                assert(!governor.is_denied(target), errors::TARGET_DENIED);

                let approvals = step.approvals;
                let mut j: u32 = 0;
                while j < approvals.len() {
                    let approval = *approvals.at(j);
                    IErc20Dispatcher { contract_address: approval.token }
                        .approve(target, approval.amount.into());
                    append_unique(ref touched, approval.token);
                    j += 1;
                };

                call_contract_syscall(target, *step.selector, step.calldata.span())
                    .unwrap_syscall();

                // -- I3: no allowance outlives the step that requested it ----
                let mut j: u32 = 0;
                while j < approvals.len() {
                    let approval = *approvals.at(j);
                    IErc20Dispatcher { contract_address: approval.token }
                        .approve(target, 0_u256);
                    j += 1;
                };

                i += 1;
            };

            // -- credit the outputs ------------------------------------------
            let mut deposits: Array<OpenNoteDeposit> = array![];
            let mut output_tokens: Array<ContractAddress> = array![];
            let mut k: u32 = 0;
            while k < outputs.len() {
                let output = *outputs.at(k);
                assert(output.token.is_non_zero(), errors::ZERO_OUTPUT_TOKEN);
                assert(!contains(output_tokens.span(), output.token), errors::DUPLICATE_OUTPUT);
                output_tokens.append(output.token);

                let erc20 = IErc20Dispatcher { contract_address: output.token };
                // The whole balance is credited, never a measured delta: the
                // zero-residue rule below means anything left here is unreachable.
                let balance = erc20.balance_of(self_addr);
                let fee = balance * params.fee_bps.into() / BPS_DENOMINATOR;
                let credited: u128 = (balance - fee).try_into().expect(errors::AMOUNT_OVERFLOW);

                // -- I5: the floor holds on what the caller actually receives
                assert(credited >= output.min_amount, errors::BELOW_MIN_AMOUNT);

                if fee.is_non_zero() {
                    erc20.transfer(params.fee_recipient, fee);
                }
                // Approve, do not transfer: the pool pulls, and that pull is what
                // turns this balance into a note.
                erc20.approve(pool_address, credited.into());

                deposits
                    .append(
                        OpenNoteDeposit {
                            note_id: output.note_id, token: output.token, amount: credited,
                        },
                    );
                k += 1;
            };

            // -- I4: nothing is left behind for the next caller to sweep -----
            // Output tokens are excluded because their balance is standing in an
            // allowance the pool is about to pull. Every other touched token must
            // already be at zero.
            let mut m: u32 = 0;
            while m < touched.len() {
                let token = *touched.at(m);
                if !contains(output_tokens.span(), token) {
                    let residue = IErc20Dispatcher { contract_address: token }
                        .balance_of(self_addr);
                    assert(residue.is_zero(), errors::RESIDUE_LEFT);
                }
                m += 1;
            };

            let plan_id = self.plans_executed.read() + 1;
            self.plans_executed.write(plan_id);
            self.locked.write(false);
            self
                .emit(
                    PlanExecuted {
                        plan_id, step_count: steps.len(), output_count: outputs.len(),
                    },
                );

            deposits.span()
        }

        fn sweep(ref self: ContractState, token: ContractAddress) {
            // A donation to this address would otherwise make I4 unsatisfiable and
            // wedge every future plan. Anyone may clear it, nobody may direct it.
            assert(!self.locked.read(), errors::SWEEP_DURING_INVOKE);
            let erc20 = IErc20Dispatcher { contract_address: token };
            let balance = erc20.balance_of(get_contract_address());
            assert(balance.is_non_zero(), errors::NOTHING_TO_SWEEP);

            let recipient = IJalinGovernorDispatcher { contract_address: self.governor.read() }
                .params()
                .fee_recipient;
            erc20.transfer(recipient, balance);
            self.emit(Swept { token, amount: balance });
        }

        fn governor(self: @ContractState) -> ContractAddress {
            self.governor.read()
        }

        fn plans_executed(self: @ContractState) -> u64 {
            self.plans_executed.read()
        }
    }

    fn contains(haystack: Span<ContractAddress>, needle: ContractAddress) -> bool {
        let mut i: u32 = 0;
        let mut found = false;
        while i < haystack.len() {
            if *haystack.at(i) == needle {
                found = true;
                break;
            }
            i += 1;
        };
        found
    }

    fn append_unique(ref list: Array<ContractAddress>, value: ContractAddress) {
        if !contains(list.span(), value) {
            list.append(value);
        }
    }
}
