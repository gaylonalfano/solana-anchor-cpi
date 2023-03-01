import * as anchor from "@project-serum/anchor";
import { expect } from "chai";
import fs from "mz/fs";


export async function createKeypairFromFile(
  filepath: string
): Promise<anchor.web3.Keypair> {
  const secretKeyString = await fs.readFile(filepath, {
    encoding: "utf8",
  });
  const secretKey = Uint8Array.from(JSON.parse(secretKeyString));
  return anchor.web3.Keypair.fromSecretKey(secretKey);
}

// // Alternate syntax:
// export function createKeypairFromFile(filepath: string): Keypair {
//   return Keypair.fromSecretKey(
//     Buffer.from(JSON.parse(fs.readFileSync(filepath, "utf-8")))
//   );
// }

// For testing async functions with Chai's expect()
// REF: https://stackoverflow.com/questions/45466040/verify-that-an-exception-is-thrown-using-mocha-chai-and-async-await
// 1. Create the helper
export const expectThrowsAsync = async (method: any, errorMessage?: string) => {
  let error = null;

  try {
    await method()
  } catch (err) {
    error = err
  }
  
  expect(error).to.be.an('Error')
  expect(error).to.be.an.instanceof(Error)
  // NOTE Could swap errorMessage for expectedError
  // and then ...to.equal(expectedError)

  if (errorMessage) {
    expect(error.message).to.equal(errorMessage)
  }
}

// 2. Have an example async function:
// const login = async (username, password) => {
//   if (!username || !password) {
//     throw new Error("Invalid username or password")
//   }
//   //await service.login(username, password)
// }

// 3. Use the helper inside Mocha describe('my test', () => {...}):
// describe('login tests', () => {
//   it('should throw validation error when not providing username or passsword', async () => {

//     await expectThrowsAsync(() => login())
//     await expectThrowsAsync(() => login(), "Invalid username or password")
//     await expectThrowsAsync(() => login("username"))
//     await expectThrowsAsync(() => login("username"), "Invalid username or password")
//     await expectThrowsAsync(() => login(null, "password"))
//     await expectThrowsAsync(() => login(null, "password"), "Invalid username or password")

//     //login("username","password") will not throw an exception, so expectation will fail
//     //await expectThrowsAsync(() => login("username", "password"))
//   })
// })


