//! The governance cycle: propose, vote privately, wait out the timelock, execute.

use snforge_std::{
    ContractClassTrait, DeclareResultTrait, declare, start_cheat_block_number_global,
    start_cheat_caller_address, stop_cheat_caller_address,
};
use starknet::{ContractAddress, contract_address_const};
use jalin::interfaces::{
    IJalinGovernanceDispatcher, IJalinGovernanceDispatcherTrait, IJalinGovernorDispatcher,
    IJalinGovernorDispatcherTrait,
};
use jalin::mocks::{IMockErc20Dispatcher, IMockErc20DispatcherTrait};
use jalin::types::{kinds, ops};

const START_BLOCK: u64 = 100;
const VOTING_BLOCKS: u64 = 10;
const TIMELOCK_BLOCKS: u64 = 5;
const QUORUM: u128 = 100;
const WEIGHT: u128 = 1000;

fn pool() -> ContractAddress {
    contract_address_const::<'POOL'>()
}

fn treasury() -> ContractAddress {
    contract_address_const::<'TREASURY'>()
}

/// Returns (governor, ballot_token).
fn setup() -> (ContractAddress, ContractAddress) {
    let erc20_class = declare("MockErc20").unwrap().contract_class();
    let (ballot_token, _) = erc20_class.deploy(@array![]).unwrap();

    let class = declare("JalinGovernor").unwrap().contract_class();
    let mut calldata: Array<felt252> = array![];
    calldata.append(pool().into());
    calldata.append(ballot_token.into());
    calldata.append(treasury().into());
    calldata.append(8); // max_steps
    calldata.append(64); // max_calldata
    calldata.append(VOTING_BLOCKS.into());
    calldata.append(TIMELOCK_BLOCKS.into());
    calldata.append(QUORUM.into());
    let (governor, _) = class.deploy(@calldata).unwrap();

    // The stake a ballot escrows has to actually be here for redemption.
    IMockErc20Dispatcher { contract_address: ballot_token }.mint(governor, WEIGHT.into());

    start_cheat_block_number_global(START_BLOCK);
    (governor, ballot_token)
}

fn cast(
    governor: ContractAddress,
    proposal_id: u64,
    support: u8,
    commitment: felt252,
    amount: u128,
) {
    start_cheat_caller_address(governor, pool());
    IJalinGovernanceDispatcher { contract_address: governor }
        .privacy_invoke(pool(), ops::CAST, proposal_id, support, commitment, 0, amount, 0);
    stop_cheat_caller_address(governor);
}

fn propose_fee_change(governor: ContractAddress, fee_bps: felt252) -> u64 {
    IJalinGovernanceDispatcher { contract_address: governor }
        .propose(kinds::FEE, treasury(), fee_bps, 0)
}

#[test]
fn a_ballot_records_weight_without_naming_a_voter() {
    let (governor, _) = setup();
    let proposal_id = propose_fee_change(governor, 50);
    let dispatcher = IJalinGovernanceDispatcher { contract_address: governor };
    let commitment = dispatcher.ballot_commitment('secret');

    cast(governor, proposal_id, 1, commitment, WEIGHT);

    let proposal = dispatcher.get_proposal(proposal_id);
    assert(proposal.yes == WEIGHT, 'weight counted');
    assert(proposal.no == 0, 'nothing against');

    // The ballot knows its own weight; it does not know who cast it. There is no
    // voter field to read because none is ever written.
    let ballot = dispatcher.get_ballot(commitment);
    assert(ballot.proposal_id == proposal_id, 'ballot bound to proposal');
    assert(ballot.amount == WEIGHT, 'stake escrowed');
    assert(!ballot.claimed, 'not redeemed yet');
}

#[test]
#[should_panic(expected: 'GOV_CALLER_NOT_POOL')]
fn a_ballot_may_only_arrive_through_the_pool() {
    let (governor, _) = setup();
    let proposal_id = propose_fee_change(governor, 50);
    let commitment = IJalinGovernanceDispatcher { contract_address: governor }
        .ballot_commitment('secret');

    // No caller cheat, so this is a direct vote rather than a private one.
    IJalinGovernanceDispatcher { contract_address: governor }
        .privacy_invoke(pool(), ops::CAST, proposal_id, 1, commitment, 0, WEIGHT, 0);
}

#[test]
#[should_panic(expected: 'GOV_COMMITMENT_USED')]
fn the_same_commitment_cannot_vote_twice() {
    let (governor, _) = setup();
    let proposal_id = propose_fee_change(governor, 50);
    let commitment = IJalinGovernanceDispatcher { contract_address: governor }
        .ballot_commitment('secret');

    cast(governor, proposal_id, 1, commitment, WEIGHT);
    cast(governor, proposal_id, 1, commitment, WEIGHT);
}

#[test]
#[should_panic(expected: 'GOV_VOTING_OPEN')]
fn stake_stays_locked_while_the_vote_is_open() {
    // This is the whole reason one set of funds cannot vote twice: it is not
    // available to be routed into a second ballot until the vote has closed.
    let (governor, _) = setup();
    let proposal_id = propose_fee_change(governor, 50);
    let commitment = IJalinGovernanceDispatcher { contract_address: governor }
        .ballot_commitment('secret');
    cast(governor, proposal_id, 1, commitment, WEIGHT);

    start_cheat_caller_address(governor, pool());
    IJalinGovernanceDispatcher { contract_address: governor }
        .privacy_invoke(pool(), ops::REDEEM, 0, 0, 0, 'secret', 0, 'NOTE');
}

#[test]
fn stake_comes_back_as_a_note_once_the_vote_closes() {
    let (governor, ballot_token) = setup();
    let proposal_id = propose_fee_change(governor, 50);
    let dispatcher = IJalinGovernanceDispatcher { contract_address: governor };
    let commitment = dispatcher.ballot_commitment('secret');
    cast(governor, proposal_id, 1, commitment, WEIGHT);

    start_cheat_block_number_global(START_BLOCK + VOTING_BLOCKS + 1);
    start_cheat_caller_address(governor, pool());
    let deposits = dispatcher
        .privacy_invoke(pool(), ops::REDEEM, 0, 0, 0, 'secret', 0, 'NOTE');
    stop_cheat_caller_address(governor);

    assert(deposits.len() == 1, 'one refund note');
    assert(*deposits.at(0).amount == WEIGHT, 'stake returned in full');
    assert(*deposits.at(0).note_id == 'NOTE', 'note id echoed');

    let allowance = IMockErc20Dispatcher { contract_address: ballot_token }
        .allowance(governor, pool());
    assert(allowance == WEIGHT.into(), 'pool may pull the refund');
    assert(dispatcher.get_ballot(commitment).claimed, 'ballot marked redeemed');
}

#[test]
#[should_panic(expected: 'GOV_TIMELOCKED')]
fn a_carried_proposal_still_waits_out_the_timelock() {
    let (governor, _) = setup();
    let proposal_id = propose_fee_change(governor, 50);
    let commitment = IJalinGovernanceDispatcher { contract_address: governor }
        .ballot_commitment('secret');
    cast(governor, proposal_id, 1, commitment, WEIGHT);

    // Voting is over, the timelock is not.
    start_cheat_block_number_global(START_BLOCK + VOTING_BLOCKS + 1);
    IJalinGovernanceDispatcher { contract_address: governor }.execute(proposal_id);
}

#[test]
#[should_panic(expected: 'GOV_NO_QUORUM')]
fn a_thin_vote_does_not_carry() {
    let (governor, _) = setup();
    let proposal_id = propose_fee_change(governor, 50);
    let commitment = IJalinGovernanceDispatcher { contract_address: governor }
        .ballot_commitment('secret');
    cast(governor, proposal_id, 1, commitment, QUORUM - 1);

    start_cheat_block_number_global(START_BLOCK + VOTING_BLOCKS + TIMELOCK_BLOCKS + 1);
    IJalinGovernanceDispatcher { contract_address: governor }.execute(proposal_id);
}

#[test]
fn a_carried_proposal_moves_the_parameter_the_router_reads() {
    let (governor, _) = setup();
    let proposal_id = propose_fee_change(governor, 50);
    let commitment = IJalinGovernanceDispatcher { contract_address: governor }
        .ballot_commitment('secret');
    cast(governor, proposal_id, 1, commitment, WEIGHT);

    start_cheat_block_number_global(START_BLOCK + VOTING_BLOCKS + TIMELOCK_BLOCKS + 1);
    IJalinGovernanceDispatcher { contract_address: governor }.execute(proposal_id);

    let params = IJalinGovernorDispatcher { contract_address: governor }.params();
    assert(params.fee_bps == 50, 'fee applied');
    assert(params.fee_recipient == treasury(), 'recipient applied');
}

#[test]
#[should_panic(expected: 'GOV_FEE_TOO_HIGH')]
fn the_fee_cap_holds_even_against_a_carried_vote() {
    // A vote can move the fee. It cannot move it past the ceiling written into
    // the contract, which is the one thing governance capture cannot reach.
    let (governor, _) = setup();
    let proposal_id = propose_fee_change(governor, 1001);
    let commitment = IJalinGovernanceDispatcher { contract_address: governor }
        .ballot_commitment('secret');
    cast(governor, proposal_id, 1, commitment, WEIGHT);

    start_cheat_block_number_global(START_BLOCK + VOTING_BLOCKS + TIMELOCK_BLOCKS + 1);
    IJalinGovernanceDispatcher { contract_address: governor }.execute(proposal_id);
}

/// Carries a proposal: one yes ballot at full weight, then past the timelock,
/// then executed. Every kind below reaches `apply` this way, which is the only
/// way router parameters can move at all.
fn carry(governor: ContractAddress, proposal_id: u64, secret: felt252) {
    let dispatcher = IJalinGovernanceDispatcher { contract_address: governor };
    cast(governor, proposal_id, 1, dispatcher.ballot_commitment(secret), WEIGHT);
    start_cheat_block_number_global(START_BLOCK + VOTING_BLOCKS + TIMELOCK_BLOCKS + 1);
    dispatcher.execute(proposal_id);
}

#[test]
fn a_carried_vote_can_pause_the_router() {
    let (governor, _) = setup();
    let params = IJalinGovernorDispatcher { contract_address: governor };
    assert(!params.params().paused, 'starts running');

    let proposal_id = IJalinGovernanceDispatcher { contract_address: governor }
        .propose(kinds::PAUSE, treasury(), 1, 0);
    carry(governor, proposal_id, 'pause');

    assert(params.params().paused, 'the circuit is open');
}

#[test]
fn a_carried_vote_can_move_the_limits() {
    let (governor, _) = setup();
    let params = IJalinGovernorDispatcher { contract_address: governor };

    let proposal_id = IJalinGovernanceDispatcher { contract_address: governor }
        .propose(kinds::LIMITS, treasury(), 3, 16);
    carry(governor, proposal_id, 'limits');

    let after = params.params();
    assert(after.max_steps == 3, 'steps tightened');
    assert(after.max_calldata == 16, 'calldata tightened');
    // Tightening the bounds must not quietly reset anything else.
    assert(!after.paused, 'still running');
}

#[test]
#[should_panic(expected: 'GOV_ZERO_LIMIT')]
fn a_limit_of_zero_would_brick_the_router_and_is_refused() {
    let (governor, _) = setup();
    let proposal_id = IJalinGovernanceDispatcher { contract_address: governor }
        .propose(kinds::LIMITS, treasury(), 0, 16);
    carry(governor, proposal_id, 'zero');
}

#[test]
fn a_carried_vote_can_deny_one_target_and_lift_it_again() {
    let (governor, _) = setup();
    let params = IJalinGovernorDispatcher { contract_address: governor };
    let bad = contract_address_const::<'BAD'>();
    let governance = IJalinGovernanceDispatcher { contract_address: governor };

    assert(!params.is_denied(bad), 'nothing denied by default');
    carry(governor, governance.propose(kinds::DENY, bad, 1, 0), 'deny');
    assert(params.is_denied(bad), 'target denied');

    // A deny list that cannot be undone is a whitelist with extra steps.
    let lift = governance.propose(kinds::DENY, bad, 0, 0);
    cast(governor, lift, 1, governance.ballot_commitment('lift'), WEIGHT);
    start_cheat_block_number_global(START_BLOCK + 2 * (VOTING_BLOCKS + TIMELOCK_BLOCKS) + 2);
    governance.execute(lift);
    assert(!params.is_denied(bad), 'target allowed again');
}

#[test]
fn a_carried_vote_can_label_a_target() {
    let (governor, _) = setup();
    let target = contract_address_const::<'ENDUR'>();

    let proposal_id = IJalinGovernanceDispatcher { contract_address: governor }
        .propose(kinds::LABEL, target, 'endur xSTRK', 0);
    carry(governor, proposal_id, 'label');

    // A label is the honest alternative to a whitelist: it says what a contract
    // is without deciding for you whether you may call it.
    assert(
        IJalinGovernorDispatcher { contract_address: governor }.label_of(target) == 'endur xSTRK',
        'label recorded',
    );
}

#[test]
fn votes_against_are_counted_and_can_sink_a_proposal() {
    let (governor, _) = setup();
    let governance = IJalinGovernanceDispatcher { contract_address: governor };
    let proposal_id = propose_fee_change(governor, 50);

    cast(governor, proposal_id, 0, governance.ballot_commitment('against'), WEIGHT);

    let proposal = governance.get_proposal(proposal_id);
    assert(proposal.no == WEIGHT, 'weight counted against');
    assert(proposal.yes == 0, 'nothing in favour');
}

#[test]
#[should_panic(expected: 'GOV_REJECTED')]
fn a_proposal_the_vote_rejected_cannot_be_executed() {
    let (governor, _) = setup();
    let governance = IJalinGovernanceDispatcher { contract_address: governor };
    let proposal_id = propose_fee_change(governor, 50);

    cast(governor, proposal_id, 0, governance.ballot_commitment('against'), WEIGHT);
    start_cheat_block_number_global(START_BLOCK + VOTING_BLOCKS + TIMELOCK_BLOCKS + 1);
    governance.execute(proposal_id);
}

#[test]
#[should_panic(expected: 'GOV_UNKNOWN_OP')]
fn the_pool_cannot_ask_for_an_operation_that_does_not_exist() {
    let (governor, _) = setup();
    start_cheat_caller_address(governor, pool());
    IJalinGovernanceDispatcher { contract_address: governor }
        .privacy_invoke(pool(), 7, 1, 1, 'c', 0, WEIGHT, 0);
}

#[test]
#[should_panic(expected: 'GOV_UNKNOWN_KIND')]
fn a_proposal_of_an_unknown_kind_is_refused_at_the_door() {
    let (governor, _) = setup();
    IJalinGovernanceDispatcher { contract_address: governor }.propose(9, treasury(), 0, 0);
}

#[test]
fn proposals_are_numbered_in_the_order_they_arrive() {
    let (governor, _) = setup();
    let governance = IJalinGovernanceDispatcher { contract_address: governor };
    assert(governance.proposal_count() == 0, 'starts empty');

    assert(propose_fee_change(governor, 10) == 1, 'first is one');
    assert(propose_fee_change(governor, 20) == 2, 'second is two');
    assert(governance.proposal_count() == 2, 'both counted');
}
