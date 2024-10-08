use anchor_lang::prelude::*;

declare_id!("65sUaBRwnyJfhdd5gA3wJWZicfeGqe7RXvRY5Bg1hhJt");

#[program]
pub mod bankrun_counter {
    use super::*;

    pub fn add_one(ctx: Context<AddOne>) -> Result<()> {
        ctx.accounts.counter.counter += 1;

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

#[account]
pub struct Counter {
    counter: u64,
}
impl Counter {
    pub const LEN: usize = 8 + 8;
}
