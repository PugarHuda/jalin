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
