//! One test per invariant in docs/threat-model.md, plus the happy path.

use snforge_std::{
    ContractClassTrait, DeclareResultTrait, declare, start_cheat_caller_address,
    stop_cheat_caller_address,
};
use starknet::{ContractAddress, contract_address_const};
use jalin::interfaces::{
    IJalinRouterDispatcher, IJalinRouterDispatcherTrait, IJalinRouterSafeDispatcher,
    IJalinRouterSafeDispatcherTrait,
};
use jalin::mocks::{
    IMockErc20Dispatcher, IMockErc20DispatcherTrait, IMockGovernorDispatcher,
    IMockGovernorDispatcherTrait,
};
use jalin::types::{Approval, Output, Step};

const IN_AMOUNT: u128 = 1000;

fn pool() -> ContractAddress {
    contract_address_const::<'POOL'>()
}

fn treasury() -> ContractAddress {
    contract_address_const::<'TREASURY'>()
}

fn deploy_erc20() -> ContractAddress {
    let class = declare("MockErc20").unwrap().contract_class();
    let (address, _) = class.deploy(@array![]).unwrap();
    address
}

/// `rate_bps` is what the target pays back per unit pulled; `pull_bps` is how much
/// of the offered allowance it actually takes.
fn deploy_swap(out_token: ContractAddress, rate_bps: u128, pull_bps: u128) -> ContractAddress {
    let class = declare("MockSwap").unwrap().contract_class();
    let mut calldata: Array<felt252> = array![];
    calldata.append(out_token.into());
    calldata.append(rate_bps.into());
    calldata.append(0);
    calldata.append(pull_bps.into());
    calldata.append(0);
    let (address, _) = class.deploy(@calldata).unwrap();
    address
}

/// Returns (router, governor, token_in, token_out, swap).
fn setup(
    rate_bps: u128, pull_bps: u128,
) -> (ContractAddress, ContractAddress, ContractAddress, ContractAddress, ContractAddress) {
    let token_in = deploy_erc20();
    let token_out = deploy_erc20();
    let swap = deploy_swap(token_out, rate_bps, pull_bps);

    let gov_class = declare("MockGovernor").unwrap().contract_class();
    let (governor, _) = gov_class.deploy(@array![treasury().into()]).unwrap();

    let router_class = declare("JalinRouter").unwrap().contract_class();
    let (router, _) = router_class.deploy(@array![governor.into()]).unwrap();

    // The pool transfers before it invokes, so the input is already here.
    IMockErc20Dispatcher { contract_address: token_in }.mint(router, IN_AMOUNT.into());
    // Float for the target to pay out of.
    IMockErc20Dispatcher { contract_address: token_out }.mint(swap, 1_000_000_u256);

    (router, governor, token_in, token_out, swap)
}

fn swap_step(
    target: ContractAddress, token_in: ContractAddress, amount: u128,
) -> Step {
    Step {
        target,
        selector: selector!("swap"),
        approvals: array![Approval { token: token_in, amount }],
        // swap(in_token: ContractAddress, in_amount: u256)
        calldata: array![token_in.into(), amount.into(), 0],
    }
}

#[test]
fn happy_path_credits_the_output_and_approves_the_pool() {
    let (router, _, token_in, token_out, swap) = setup(10000, 10000);

    start_cheat_caller_address(router, pool());
    let deposits = IJalinRouterDispatcher { contract_address: router }
        .privacy_invoke(
            pool(),
            array![swap_step(swap, token_in, IN_AMOUNT)],
            array![Output { token: token_out, note_id: 'NOTE', min_amount: IN_AMOUNT }],
        );
    stop_cheat_caller_address(router);

    assert(deposits.len() == 1, 'one deposit');
    let deposit = *deposits.at(0);
    assert(deposit.note_id == 'NOTE', 'note id echoed');
    assert(deposit.token == token_out, 'output token');
    assert(deposit.amount == IN_AMOUNT, 'full amount credited');

    // The pool pulls what was approved, so the allowance is the credit.
    let allowance = IMockErc20Dispatcher { contract_address: token_out }
        .allowance(router, pool());
    assert(allowance == IN_AMOUNT.into(), 'pool may pull the credit');
}

#[test]
fn a_plan_may_credit_nothing_back_when_value_leaves_for_good() {
    // A bridge leg looks like this from the pool: the target takes everything and
    // hands nothing back on this chain. The protocol allows an empty Span, so the
    // router must too, and I4 is what proves the value really did leave.
    let (router, _, token_in, _, sink) = setup(0, 10000);

    start_cheat_caller_address(router, pool());
    let deposits = IJalinRouterDispatcher { contract_address: router }
        .privacy_invoke(pool(), array![swap_step(sink, token_in, IN_AMOUNT)], array![]);
    stop_cheat_caller_address(router);

    assert(deposits.len() == 0, 'nothing credited back');
    let left = IMockErc20Dispatcher { contract_address: token_in }.balance_of(router);
    assert(left == 0, 'all of it left the router');
}

#[test]
#[should_panic(expected: 'JALIN_NO_STEPS')]
fn rejects_a_plan_that_does_nothing() {
    let (router, _, _, _, _) = setup(10000, 10000);

    start_cheat_caller_address(router, pool());
    IJalinRouterDispatcher { contract_address: router }
        .privacy_invoke(pool(), array![], array![]);
}

#[test]
#[should_panic(expected: 'JALIN_CALLER_NOT_POOL')]
fn i1_rejects_a_caller_that_is_not_the_pool() {
    let (router, _, token_in, token_out, swap) = setup(10000, 10000);

    // No cheat: the caller is the test account, not the pool it claims to be.
    IJalinRouterDispatcher { contract_address: router }
        .privacy_invoke(
            pool(),
            array![swap_step(swap, token_in, IN_AMOUNT)],
            array![Output { token: token_out, note_id: 'NOTE', min_amount: 0 }],
        );
}

#[test]
#[should_panic(expected: 'JALIN_TARGET_IS_POOL')]
fn i2_rejects_a_step_aimed_at_the_pool() {
    let (router, _, token_in, token_out, _) = setup(10000, 10000);

    start_cheat_caller_address(router, pool());
    IJalinRouterDispatcher { contract_address: router }
        .privacy_invoke(
            pool(),
            array![swap_step(pool(), token_in, IN_AMOUNT)],
            array![Output { token: token_out, note_id: 'NOTE', min_amount: 0 }],
        );
}

#[test]
#[should_panic(expected: 'JALIN_TARGET_IS_SELF')]
fn i2_rejects_a_step_aimed_at_the_router() {
    let (router, _, token_in, token_out, _) = setup(10000, 10000);

    start_cheat_caller_address(router, pool());
    IJalinRouterDispatcher { contract_address: router }
        .privacy_invoke(
            pool(),
            array![swap_step(router, token_in, IN_AMOUNT)],
            array![Output { token: token_out, note_id: 'NOTE', min_amount: 0 }],
        );
}

#[test]
fn i3_leaves_no_allowance_behind_after_a_step() {
    // The target pulls only half, so it walks away from the rest of the
    // allowance. Nothing of that allowance may survive the step.
    let (router, _, token_in, token_out, swap) = setup(10000, 5000);

    start_cheat_caller_address(router, pool());
    IJalinRouterDispatcher { contract_address: router }
        .privacy_invoke(
            pool(),
            array![swap_step(swap, token_in, IN_AMOUNT)],
            // token_in is declared too, so the untaken half is credited rather
            // than tripping the residue check - this test is about I3 alone.
            array![
                Output { token: token_out, note_id: 'OUT', min_amount: 0 },
                Output { token: token_in, note_id: 'BACK', min_amount: 0 },
            ],
        );
    stop_cheat_caller_address(router);

    let leftover = IMockErc20Dispatcher { contract_address: token_in }.allowance(router, swap);
    assert(leftover == 0, 'allowance must be cleared');
}

#[test]
#[should_panic(expected: 'JALIN_RESIDUE_LEFT')]
fn i4_rejects_a_plan_that_leaves_value_behind() {
    // Half the input is never taken and is not declared as an output, so it
    // would sit on the router waiting for the next caller to claim it.
    let (router, _, token_in, token_out, swap) = setup(10000, 5000);

    start_cheat_caller_address(router, pool());
    IJalinRouterDispatcher { contract_address: router }
        .privacy_invoke(
            pool(),
            array![swap_step(swap, token_in, IN_AMOUNT)],
            array![Output { token: token_out, note_id: 'OUT', min_amount: 0 }],
        );
}

#[test]
#[should_panic(expected: 'JALIN_BELOW_MIN_AMOUNT')]
fn i5_rejects_an_output_under_its_floor() {
    // Pays back half of what it takes.
    let (router, _, token_in, token_out, swap) = setup(5000, 10000);

    start_cheat_caller_address(router, pool());
    IJalinRouterDispatcher { contract_address: router }
        .privacy_invoke(
            pool(),
            array![swap_step(swap, token_in, IN_AMOUNT)],
            array![Output { token: token_out, note_id: 'OUT', min_amount: IN_AMOUNT }],
        );
}

#[test]
#[should_panic(expected: 'JALIN_TOO_MANY_STEPS')]
fn i6_rejects_a_plan_over_the_step_bound() {
    let (router, governor, token_in, token_out, swap) = setup(10000, 10000);
    IMockGovernorDispatcher { contract_address: governor }.set_limits(1, 64);

    start_cheat_caller_address(router, pool());
    IJalinRouterDispatcher { contract_address: router }
        .privacy_invoke(
            pool(),
            array![
                swap_step(swap, token_in, IN_AMOUNT / 2),
                swap_step(swap, token_in, IN_AMOUNT / 2),
            ],
            array![Output { token: token_out, note_id: 'OUT', min_amount: 0 }],
        );
}

#[test]
#[should_panic(expected: 'JALIN_TARGET_DENIED')]
fn governance_can_break_the_circuit_on_one_target() {
    let (router, governor, token_in, token_out, swap) = setup(10000, 10000);
    IMockGovernorDispatcher { contract_address: governor }.set_denied(swap, true);

    start_cheat_caller_address(router, pool());
    IJalinRouterDispatcher { contract_address: router }
        .privacy_invoke(
            pool(),
            array![swap_step(swap, token_in, IN_AMOUNT)],
            array![Output { token: token_out, note_id: 'OUT', min_amount: 0 }],
        );
}

#[test]
#[should_panic(expected: 'JALIN_PAUSED')]
fn governance_can_pause_every_plan() {
    let (router, governor, token_in, token_out, swap) = setup(10000, 10000);
    IMockGovernorDispatcher { contract_address: governor }.set_paused(true);

    start_cheat_caller_address(router, pool());
    IJalinRouterDispatcher { contract_address: router }
        .privacy_invoke(
            pool(),
            array![swap_step(swap, token_in, IN_AMOUNT)],
            array![Output { token: token_out, note_id: 'OUT', min_amount: 0 }],
        );
}

#[test]
#[should_panic(expected: 'JALIN_DUPLICATE_OUTPUT')]
fn rejects_the_same_output_token_twice() {
    let (router, _, token_in, token_out, swap) = setup(10000, 10000);

    start_cheat_caller_address(router, pool());
    IJalinRouterDispatcher { contract_address: router }
        .privacy_invoke(
            pool(),
            array![swap_step(swap, token_in, IN_AMOUNT)],
            array![
                Output { token: token_out, note_id: 'A', min_amount: 0 },
                Output { token: token_out, note_id: 'B', min_amount: 0 },
            ],
        );
}

#[test]
fn fee_is_taken_from_the_credit_not_from_the_floor() {
    let (router, governor, token_in, token_out, swap) = setup(10000, 10000);
    // 1% to the treasury.
    IMockGovernorDispatcher { contract_address: governor }.set_fee(100, treasury());

    start_cheat_caller_address(router, pool());
    let deposits = IJalinRouterDispatcher { contract_address: router }
        .privacy_invoke(
            pool(),
            array![swap_step(swap, token_in, IN_AMOUNT)],
            array![Output { token: token_out, note_id: 'OUT', min_amount: 990 }],
        );
    stop_cheat_caller_address(router);

    assert(*deposits.at(0).amount == 990, 'credit is net of the fee');
    let taken = IMockErc20Dispatcher { contract_address: token_out }.balance_of(treasury());
    assert(taken == 10, 'treasury took the fee');
}

#[test]
fn sweep_sends_a_donation_to_the_treasury() {
    let (router, _, token_in, _, _) = setup(10000, 10000);
    // setup() minted the input straight onto the router, which is exactly what a
    // hostile donation looks like from the outside.
    IJalinRouterDispatcher { contract_address: router }.sweep(token_in);

    let swept = IMockErc20Dispatcher { contract_address: token_in }.balance_of(treasury());
    assert(swept == IN_AMOUNT.into(), 'donation cleared to treasury');
    let left = IMockErc20Dispatcher { contract_address: token_in }.balance_of(router);
    assert(left == 0, 'router is empty again');
}

// -- fuzzed ------------------------------------------------------------------
// Every test above pins one amount. An invariant checked at one point is an
// invariant that has not been checked; these run the same paths over values
// snforge picks.

#[test]
#[fuzzer]
fn fee_never_loses_value(seed: u128) {
    // The fee is taken out of the credit, so fee plus credit has to be the whole
    // balance for every amount. Rounding that drops a unit is rounding that takes
    // it from somebody, and at u128 scale a fixed-value test would never see it.
    let extra: u128 = 1 + (seed % 1_000_000_000_000_000);
    let (router, governor, token_in, token_out, swap) = setup(10000, 10000);
    IMockGovernorDispatcher { contract_address: governor }.set_fee(100, treasury());

    // setup() already put IN_AMOUNT on the router, and the step has to move all
    // of it: anything left of a touched token trips the residue rule.
    IMockErc20Dispatcher { contract_address: token_in }.mint(router, extra.into());
    let moving: u128 = IN_AMOUNT + extra;
    IMockErc20Dispatcher { contract_address: token_out }.mint(swap, moving.into());

    start_cheat_caller_address(router, pool());
    let deposits = IJalinRouterDispatcher { contract_address: router }
        .privacy_invoke(
            pool(),
            array![swap_step(swap, token_in, moving)],
            array![Output { token: token_out, note_id: 'OUT', min_amount: 0 }],
        );
    stop_cheat_caller_address(router);

    // The target pays one for one, so the router received exactly `moving`.
    let credited = *deposits.at(0).amount;
    let taken = IMockErc20Dispatcher { contract_address: token_out }.balance_of(treasury());
    assert(credited.into() + taken == moving.into(), 'fee plus credit is the whole');
    assert(taken == (moving / 100).into(), 'one percent, no more');
}

#[test]
#[fuzzer]
fn i5_rejects_every_amount_under_its_floor(seed: u128) {
    // Whatever the size, a floor above what comes back must stop the plan.
    let amount: u128 = 1_000_000 + (seed % 1_000_000_000_000);
    let (router, _, token_in, token_out, swap) = setup(5000, 10000); // pays back half
    IMockErc20Dispatcher { contract_address: token_in }.mint(router, amount.into());

    start_cheat_caller_address(router, pool());
    let call = IJalinRouterSafeDispatcher { contract_address: router }
        .privacy_invoke(
            pool(),
            array![swap_step(swap, token_in, amount)],
            array![Output { token: token_out, note_id: 'OUT', min_amount: amount }],
        );
    stop_cheat_caller_address(router);

    match call {
        Result::Ok(_) => panic!("a floor above the payout must not pass"),
        Result::Err(_) => (),
    }
}

#[test]
fn the_plan_counter_moves_and_the_governor_is_the_one_it_was_given() {
    // Both of these are read off-chain - the counter is the number on the landing
    // page, and the governor is what a reader checks to see who owns the params.
    let (router, governor, token_in, token_out, swap) = setup(10000, 10000);
    let dispatcher = IJalinRouterDispatcher { contract_address: router };

    assert(dispatcher.governor() == governor, 'points at its governor');
    assert(dispatcher.plans_executed() == 0, 'nothing run yet');

    start_cheat_caller_address(router, pool());
    dispatcher
        .privacy_invoke(
            pool(),
            array![swap_step(swap, token_in, IN_AMOUNT)],
            array![Output { token: token_out, note_id: 'NOTE', min_amount: IN_AMOUNT }],
        );
    stop_cheat_caller_address(router);

    assert(dispatcher.plans_executed() == 1, 'one plan run');
}
