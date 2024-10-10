use anchor_lang::prelude::*;
use anchor_spl::{associated_token::AssociatedToken, token::{self, Mint, Token, TokenAccount, Transfer}};

pub mod errors;

use crate::errors::ErrorCode;

declare_id!("BTowJtegiE7st2TGyHjYYuqmuF63XZNyUqU8fBJnefbc");

#[program]
pub mod bankrun_counter {
    use super::*;

    pub fn add_one(ctx: Context<AddOne>) -> Result<()> {
        let now = Clock::get().unwrap().unix_timestamp;

        // Only add every 5 minutes
        require!(
            now > (ctx.accounts.counter.last_modified + 5 * 60),
            ErrorCode::CannotAddYet
        );

        ctx.accounts.counter.last_modified = now;
        ctx.accounts.counter.counter += 1;

        Ok(())
    }

    pub fn transfer_one_token(ctx: Context<TransferOneToken>) -> Result<()> {
        let now = Clock::get().unwrap().unix_timestamp;

        // Only transfer every 5 minutes
        require!(
            now > (ctx.accounts.pda_auth.last_transfer + 5 * 60),
            ErrorCode::CannotTransferYet
        );

        ctx.accounts.pda_auth.last_transfer = now;
            
        let amount_to_transfer: u64 = 1;
        
        let pda_auth_seeds = &[
            "pda_auth".as_bytes(),
            &[ctx.bumps.pda_auth],
        ];

        let transfer_accounts: Transfer = Transfer {
            from: ctx.accounts.pda_auth_ata.to_account_info().clone(),
            to: ctx.accounts.receiver_ata.to_account_info().clone(),
            authority: ctx.accounts.pda_auth.to_account_info().clone(),
        };
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info().clone(),
                transfer_accounts,
                &[&pda_auth_seeds[..]],
            ),
            amount_to_transfer,
        )?;


        Ok(())
    }
}

#[derive(Accounts)]
pub struct AddOne<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        init_if_needed,
        seeds = ["counter".as_bytes(), owner.key().as_ref()],
        bump,
        payer = owner,
        space = Counter::LEN,
    )]
    pub counter: Account<'info, Counter>,

    pub system_program: Program<'info, System>,
}

// TransferToken
#[derive(Accounts)]
pub struct TransferOneToken<'info> {
    #[account(mut)]
    pub receiver: Signer<'info>,

    pub bankrun_counter_mint: Account<'info, Mint>,

    #[account(
        init_if_needed,
        seeds = ["pda_auth".as_bytes()],
        bump,
        payer = receiver,
        space = PdaAuth::LEN,
    )]
    pub pda_auth: Account<'info, PdaAuth>, 

    #[account(
        mut, 
        associated_token::mint = bankrun_counter_mint, 
        associated_token::authority = pda_auth
    )]
    pub pda_auth_ata: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = receiver,
        associated_token::mint = bankrun_counter_mint, 
        associated_token::authority = receiver
    )]
    pub receiver_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

// State
#[account]
pub struct Counter {
    counter: u64,
    last_modified: i64,
}
impl Counter {
    pub const LEN: usize = 8 + 8 * 2;
}

#[account]
pub struct PdaAuth {
    last_transfer: i64,
}
impl PdaAuth {
    pub const LEN: usize = 8 + 8;
}
