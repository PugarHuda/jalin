//! The router against the real thing.
//!
//! Every other test in this suite runs against mocks, which prove the invariants
//! hold but cannot prove the router works with a contract nobody here wrote. A
//! mock ERC-4626 returns what the mock was told to return; Endur's vault returns
//! what Endur's vault returns, argument order and all.
//!
//! So this forks Starknet mainnet at a pinned block and runs a plan through the
//! deployed xSTRK vault, funded by the STRK20 pool's own STRK - which is exactly
//! where the STRK comes from in a real transaction.

use snforge_std::{
    ContractClassTrait, DeclareResultTrait, declare, start_cheat_caller_address,
    stop_cheat_caller_address,
};
use starknet::{ContractAddress, contract_address_const};
use jalin::interfaces::{
    IErc20Dispatcher, IErc20DispatcherTrait, IJalinRouterDispatcher, IJalinRouterDispatcherTrait,
};
use jalin::types::{Approval, Output, Step};

/// The two ERC-20 entrypoints the router never calls itself, so they are not on
/// the production interface. The pool calls them, and this is where the test
/// stands in for the pool.
#[starknet::interface]
trait IErc20Pull<TState> {
    fn allowance(self: @TState, owner: ContractAddress, spender: ContractAddress) -> u256;
    fn transfer_from(
        ref self: TState, sender: ContractAddress, recipient: ContractAddress, amount: u256,
    ) -> bool;
}

/// One STRK, in base units.
const ONE: u128 = 1_000_000_000_000_000_000;

fn strk() -> ContractAddress {
    contract_address_const::<0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d>()
}

/// Endur's liquid staking vault. An ERC-4626 whose share token is itself, so the
/// output token and the target are the same address.
fn endur() -> ContractAddress {
    contract_address_const::<0x28d709c875c0ceac3dce7065bec5328186dc89fe254527084d1689910954b0a>()
}

/// The STRK20 shielded pool. It holds millions of STRK and, in a real plan, is
/// the contract that hands the router its input before calling `privacy_invoke`.
fn pool() -> ContractAddress {
    contract_address_const::<0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a>()
}

fn treasury() -> ContractAddress {
    contract_address_const::<'TREASURY'>()
}

/// The real governor, not the mock - so this also proves the deployed pair works
/// together rather than only that each half works alone.
fn deploy_stack() -> ContractAddress {
    let gov_class = declare("JalinGovernor").unwrap().contract_class();
    let (governor, _) = gov_class
        .deploy(
            @array![
                pool().into(), // pool
                strk().into(), // ballot token
                treasury().into(), // fee recipient
                8, // max steps
                64, // max calldata
                100, // voting blocks
                10, // timelock blocks
                1, // quorum
            ],
        )
        .unwrap();

    let router_class = declare("JalinRouter").unwrap().contract_class();
    let (router, _) = router_class.deploy(@array![governor.into()]).unwrap();
    router
}

/// Moves STRK out of the pool the way the pool itself would.
fn fund(router: ContractAddress, amount: u128) {
    let token = IErc20Dispatcher { contract_address: strk() };
    start_cheat_caller_address(strk(), pool());
    token.transfer(router, amount.into());
    stop_cheat_caller_address(strk());
}

#[test]
#[fork("MAINNET")]
fn deposits_into_the_real_endur_vault() {
    let router = deploy_stack();
    fund(router, ONE);

    let steps = array![
        Step {
            target: endur(),
            selector: selector!("deposit"),
            approvals: array![Approval { token: strk(), amount: ONE }],
            // deposit(assets: u256, receiver: ContractAddress). The order is the
            // ERC-4626 one, checked against the deployed vault rather than
            // assumed from the standard.
            calldata: array![ONE.into(), 0, router.into()],
        },
    ];

    // A floor well under par. One STRK cannot buy a whole share of a vault that
    // has been accruing staking rewards since launch, so this is loose on
    // purpose - the tight assertion is below, on what actually came back.
    let outputs = array![Output { token: endur(), note_id: 'NOTE', min_amount: ONE / 2 }];

    start_cheat_caller_address(router, pool());
    let credited = IJalinRouterDispatcher { contract_address: router }
        .privacy_invoke(pool(), steps, outputs);

    assert(credited.len() == 1, 'one output, one note');
    let note = *credited.at(0);
    assert(note.token == endur(), 'credited in xSTRK');
    assert(note.note_id == 'NOTE', 'note id passed through');

    // xSTRK appreciates against STRK, so one STRK buys strictly fewer than one
    // share. A mock would have to be told this; the live vault simply is it.
    assert(note.amount > ONE / 2, 'more than the floor');
    assert(note.amount < ONE, 'a share is worth over par');
}

#[test]
#[fork("MAINNET")]
fn hands_the_real_shares_to_the_pool_and_keeps_nothing() {
    let router = deploy_stack();
    fund(router, ONE);

    let steps = array![
        Step {
            target: endur(),
            selector: selector!("deposit"),
            approvals: array![Approval { token: strk(), amount: ONE }],
            calldata: array![ONE.into(), 0, router.into()],
        },
    ];
    let outputs = array![Output { token: endur(), note_id: 'NOTE', min_amount: 0 }];

    start_cheat_caller_address(router, pool());
    let credited = IJalinRouterDispatcher { contract_address: router }
        .privacy_invoke(pool(), steps, outputs);
    let amount: u256 = (*credited.at(0)).amount.into();

    // I4 against a contract that was under no obligation to cooperate. The vault
    // takes the whole allowance, so no STRK is left - and if a future version of
    // it took less, this is the test that would say so.
    let strk_left = IErc20Dispatcher { contract_address: strk() }.balance_of(router);
    assert(strk_left == 0, 'no STRK left in the router');

    // The shares are still here, because crediting an output is an approval and
    // not a transfer. The pool collects them; the router only promises them.
    let shares = IErc20Dispatcher { contract_address: endur() };
    assert(shares.balance_of(router) == amount, 'shares held for the pool');

    let vault = IErc20PullDispatcher { contract_address: endur() };
    assert(vault.allowance(router, pool()) == amount, 'pool approved for exactly it');

    // Now do what the pool does next, and the router ends the transaction empty.
    start_cheat_caller_address(endur(), pool());
    vault.transfer_from(router, pool(), amount);
    stop_cheat_caller_address(endur());
    assert(shares.balance_of(router) == 0, 'router ends up holding none');
}

#[test]
#[fork("MAINNET")]
#[should_panic(expected: 'JALIN_BELOW_MIN_AMOUNT')]
fn the_floor_holds_against_a_real_price() {
    let router = deploy_stack();
    fund(router, ONE);

    let steps = array![
        Step {
            target: endur(),
            selector: selector!("deposit"),
            approvals: array![Approval { token: strk(), amount: ONE }],
            calldata: array![ONE.into(), 0, router.into()],
        },
    ];

    // Demand a whole share for one STRK. The vault trades above par, so this is
    // a floor the real market cannot meet, and the plan has to revert rather
    // than credit less than was asked for.
    let outputs = array![Output { token: endur(), note_id: 'NOTE', min_amount: ONE }];

    start_cheat_caller_address(router, pool());
    IJalinRouterDispatcher { contract_address: router }.privacy_invoke(pool(), steps, outputs);
}
