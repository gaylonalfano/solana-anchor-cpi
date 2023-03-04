use anchor_lang::prelude::*;

declare_id!("2ZdKfWepCPcrRTuiPrkgyGc5WwJBamQPxGwekUrsaJ4q");

#[program]
pub mod solana_anchor_cpi {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
