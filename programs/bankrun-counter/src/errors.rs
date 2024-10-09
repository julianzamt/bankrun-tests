use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("must pass 5 minutes since last add")]
    CannotAddYet,
    #[msg("must pass 5 minutes since last transfer")]
    CannotTransferYet
}