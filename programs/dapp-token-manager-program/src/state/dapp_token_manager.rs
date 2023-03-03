use anchor_lang::prelude::*;


#[account]
#[derive(Default, Debug)]
pub struct DappTokenManager {
    // Q: Do I need caller_program?
    // A: Yes, if I want to use it as a seed.
    // I won't have the caller_program account in the Context,
    // but I can pass the caller_program as IX data.
    // 8 bytes for Discrimator
    pub caller_program: Pubkey,     // 32 bytes Calling ProgramID
    pub mint: Pubkey,               // 32 bytes Dapp Token Mint
    pub supply_amount_per_mint: u64,           // 8 bytes 
    // Q: What's going to be the authority
    // for a new DTM? The caller program? 
    // A PDA of the caller program? A wallet?
    pub authority: Pubkey,          // 32 bytes Initializer/Payer
    pub total_mint_count: u64,      // 8 bytes
    pub bump: u8,                   // 1 byte
}

// Adding useful constants for sizing properties to better target memcmp offsets
// REF: https://lorisleiva.com/create-a-solana-dapp-from-scratch/structuring-our-tweet-account#final-code
const DISCRIMINATOR_LENGTH: usize = 8;
const CALLER_PROGRAM_LENGTH: usize = 32; // Pubkey
const MINT_LENGTH: usize = 32; // Pubkey
const SUPPLY_AMOUNT_PER_MINT_LENGTH: usize = 8; // u64
const AUTHORITY_LENGTH: usize = 32; // Pubkey
const TOTAL_MINT_COUNT_LENGTH: usize = 8; // u64
const BUMP_LENGTH: usize = 1;


impl DappTokenManager {
    pub const ACCOUNT_SPACE: usize = DISCRIMINATOR_LENGTH
        + CALLER_PROGRAM_LENGTH
        + MINT_LENGTH
        + SUPPLY_AMOUNT_PER_MINT_LENGTH
        + AUTHORITY_LENGTH
        + TOTAL_MINT_COUNT_LENGTH
        + BUMP_LENGTH;

    pub const SEED_PREFIX: &'static str = "dapp-token-manager";
    // NOTE To get MAX of type: u32::MAX
    pub fn new(caller_program: Pubkey, mint: Pubkey, supply_amount_per_mint: u64, authority: Pubkey, bump: u8) -> Self {
        DappTokenManager {
            caller_program,
            mint,
            supply_amount_per_mint,
            authority,
            total_mint_count: 0,
            bump,
        }
    }
}
