use anchor_lang::prelude::*;

declare_id!("7LXZ8onmdiK629ZfPnDKXMSL7tbEnuLzsvpzokCNonq4");

#[program]
pub mod solana_anchor_cpi {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
