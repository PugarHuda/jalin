use starknet::ContractAddress;

/// Must match `privacy::objects::OpenNoteDeposit` (positional Serde).
/// The pool deserializes our return value against this exact layout.
#[derive(Serde, Copy, Drop, PartialEq, Debug)]
pub struct OpenNoteDeposit {
    pub note_id: felt252,
    pub token: ContractAddress,
    pub amount: u128,
}

/// An allowance a step needs before its call runs. Reset to zero after the
/// step returns, so no allowance ever outlives the step that asked for it.
#[derive(Serde, Copy, Drop, PartialEq, Debug)]
pub struct Approval {
    pub token: ContractAddress,
    pub amount: u128,
}

/// One leg of a plan: an arbitrary Starknet call, plus the allowances it needs.
/// `target` and `calldata` are unrestricted by design - see docs/threat-model.md.
#[derive(Serde, Drop)]
pub struct Step {
    pub target: ContractAddress,
    pub selector: felt252,
    pub approvals: Array<Approval>,
    pub calldata: Array<felt252>,
}

/// A token the caller wants credited back into a shielded note.
/// `note_id` carries the wallet's `${openNoteIds[N]}` placeholder.
#[derive(Serde, Copy, Drop, PartialEq, Debug)]
pub struct Output {
    pub token: ContractAddress,
    pub note_id: felt252,
    pub min_amount: u128,
}

/// Router limits, owned by the governor rather than by an admin key.
#[derive(Serde, Copy, Drop, PartialEq, Debug, starknet::Store)]
pub struct RouterParams {
    pub paused: bool,
    pub max_steps: u32,
    pub max_calldata: u32,
    pub fee_bps: u16,
    pub fee_recipient: ContractAddress,
}

pub mod errors {
    // Invariant I1 - the pool is the only legitimate caller.
    pub const CALLER_NOT_POOL: felt252 = 'JALIN_CALLER_NOT_POOL';
    pub const ZERO_POOL: felt252 = 'JALIN_ZERO_POOL';
    // Invariant I2 - no step may re-enter the sandwich.
    pub const TARGET_IS_POOL: felt252 = 'JALIN_TARGET_IS_POOL';
    pub const TARGET_IS_SELF: felt252 = 'JALIN_TARGET_IS_SELF';
    pub const TARGET_DENIED: felt252 = 'JALIN_TARGET_DENIED';
    pub const ZERO_TARGET: felt252 = 'JALIN_ZERO_TARGET';
    pub const ZERO_SELECTOR: felt252 = 'JALIN_ZERO_SELECTOR';
    // Invariant I4 - nothing may be left behind.
    pub const RESIDUE_LEFT: felt252 = 'JALIN_RESIDUE_LEFT';
    // Invariant I5 - the caller's floor must hold.
    pub const BELOW_MIN_AMOUNT: felt252 = 'JALIN_BELOW_MIN_AMOUNT';
    // Invariant I6 - bounded work.
    pub const TOO_MANY_STEPS: felt252 = 'JALIN_TOO_MANY_STEPS';
    pub const CALLDATA_TOO_LONG: felt252 = 'JALIN_CALLDATA_TOO_LONG';
    // General
    pub const PAUSED: felt252 = 'JALIN_PAUSED';
    pub const NO_OUTPUTS: felt252 = 'JALIN_NO_OUTPUTS';
    pub const DUPLICATE_OUTPUT: felt252 = 'JALIN_DUPLICATE_OUTPUT';
    pub const ZERO_OUTPUT_TOKEN: felt252 = 'JALIN_ZERO_OUTPUT_TOKEN';
    pub const AMOUNT_OVERFLOW: felt252 = 'JALIN_AMOUNT_OVERFLOW';
    pub const SWEEP_DURING_INVOKE: felt252 = 'JALIN_SWEEP_DURING_INVOKE';
    pub const NOTHING_TO_SWEEP: felt252 = 'JALIN_NOTHING_TO_SWEEP';
}

// ---------------------------------------------------------------------------
// Governance
// ---------------------------------------------------------------------------

/// A parameter change waiting on a vote and then on a timelock.
#[derive(Serde, Copy, Drop, PartialEq, Debug, starknet::Store)]
pub struct Proposal {
    pub kind: u8,
    /// Deny-list entry, fee recipient, or the address being labelled.
    pub target: ContractAddress,
    pub value_a: felt252,
    pub value_b: felt252,
    pub end_block: u64,
    /// Earliest block at which this may execute.
    pub eta: u64,
    pub yes: u128,
    pub no: u128,
    pub executed: bool,
}

/// An escrowed ballot, keyed by a commitment so the voter stays unknown.
#[derive(Serde, Copy, Drop, PartialEq, Debug, starknet::Store)]
pub struct Ballot {
    pub proposal_id: u64,
    pub amount: u128,
    pub claimed: bool,
}

pub mod kinds {
    pub const PAUSE: u8 = 0;
    pub const LIMITS: u8 = 1;
    pub const FEE: u8 = 2;
    pub const DENY: u8 = 3;
    pub const LABEL: u8 = 4;
}

pub mod ops {
    pub const CAST: u8 = 0;
    pub const REDEEM: u8 = 1;
}

pub mod gov_errors {
    pub const ZERO_POOL: felt252 = 'GOV_ZERO_POOL';
    pub const ZERO_BALLOT_TOKEN: felt252 = 'GOV_ZERO_BALLOT_TOKEN';
    pub const ZERO_LIMIT: felt252 = 'GOV_ZERO_LIMIT';
    pub const BAD_POOL: felt252 = 'GOV_BAD_POOL';
    pub const CALLER_NOT_POOL: felt252 = 'GOV_CALLER_NOT_POOL';
    pub const UNKNOWN_OP: felt252 = 'GOV_UNKNOWN_OP';
    pub const UNKNOWN_KIND: felt252 = 'GOV_UNKNOWN_KIND';
    pub const ZERO_COMMITMENT: felt252 = 'GOV_ZERO_COMMITMENT';
    pub const ZERO_WEIGHT: felt252 = 'GOV_ZERO_WEIGHT';
    pub const BAD_SUPPORT: felt252 = 'GOV_BAD_SUPPORT';
    pub const NO_PROPOSAL: felt252 = 'GOV_NO_PROPOSAL';
    pub const VOTING_CLOSED: felt252 = 'GOV_VOTING_CLOSED';
    pub const VOTING_OPEN: felt252 = 'GOV_VOTING_OPEN';
    pub const COMMITMENT_USED: felt252 = 'GOV_COMMITMENT_USED';
    pub const NO_BALLOT: felt252 = 'GOV_NO_BALLOT';
    pub const ALREADY_CLAIMED: felt252 = 'GOV_ALREADY_CLAIMED';
    pub const ALREADY_EXECUTED: felt252 = 'GOV_ALREADY_EXECUTED';
    pub const TIMELOCKED: felt252 = 'GOV_TIMELOCKED';
    pub const REJECTED: felt252 = 'GOV_REJECTED';
    pub const NO_QUORUM: felt252 = 'GOV_NO_QUORUM';
    pub const BAD_VALUE: felt252 = 'GOV_BAD_VALUE';
    pub const FEE_TOO_HIGH: felt252 = 'GOV_FEE_TOO_HIGH';
}
