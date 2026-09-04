use starknet::ContractAddress;
use crate::types::{Ballot, OpenNoteDeposit, Output, Proposal, RouterParams, Step};

#[starknet::interface]
pub trait IErc20<TState> {
    fn balance_of(self: @TState, account: ContractAddress) -> u256;
    fn approve(ref self: TState, spender: ContractAddress, amount: u256) -> bool;
    fn transfer(ref self: TState, recipient: ContractAddress, amount: u256) -> bool;
}

#[starknet::interface]
pub trait IJalinRouter<TState> {
    /// Called by the pool via `selector!("privacy_invoke")`.
    /// `pool_address` carries the wallet's `${poolAddress}` placeholder and is
    /// checked against the caller, so a forged plan cannot redirect the sandwich.
    fn privacy_invoke(
        ref self: TState,
        pool_address: ContractAddress,
        steps: Array<Step>,
        outputs: Array<Output>,
    ) -> Span<OpenNoteDeposit>;

    /// Permissionless. Pushes an idle balance to the governor's fee recipient so a
    /// donation cannot wedge the zero-residue invariant into a permanent revert.
    fn sweep(ref self: TState, token: ContractAddress);

    fn governor(self: @TState) -> ContractAddress;
    fn plans_executed(self: @TState) -> u64;
}

/// The read side the router depends on, kept separate so the router never needs
/// to know that governance has proposals, ballots or a timelock at all.
#[starknet::interface]
pub trait IJalinGovernor<TState> {
    fn params(self: @TState) -> RouterParams;
    fn is_denied(self: @TState, target: ContractAddress) -> bool;
    fn label_of(self: @TState, target: ContractAddress) -> felt252;
}

#[starknet::interface]
pub trait IJalinGovernance<TState> {
    fn propose(
        ref self: TState,
        kind: u8,
        target: ContractAddress,
        value_a: felt252,
        value_b: felt252,
    ) -> u64;

    /// Ballots are delivered by the pool, so the weight is public and the voter
    /// is not. `operation` is `ops::CAST` or `ops::REDEEM`.
    fn privacy_invoke(
        ref self: TState,
        pool_address: ContractAddress,
        operation: u8,
        proposal_id: u64,
        support: u8,
        commitment: felt252,
        secret: felt252,
        amount: u128,
        note_id: felt252,
    ) -> Span<OpenNoteDeposit>;

    fn execute(ref self: TState, proposal_id: u64);
    fn get_proposal(self: @TState, proposal_id: u64) -> Proposal;
    fn get_ballot(self: @TState, commitment: felt252) -> Ballot;
    fn ballot_commitment(self: @TState, secret: felt252) -> felt252;
    fn proposal_count(self: @TState) -> u64;

    /// Stake escrowed by ballots cast and not yet redeemed. Readable so the
    /// backing behind a tally can be checked against the contract's own token
    /// balance from outside.
    fn outstanding(self: @TState) -> u128;
}
