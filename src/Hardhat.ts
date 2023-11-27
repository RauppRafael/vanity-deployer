import hre from 'hardhat'
import { Wallet, TransactionResponse } from 'ethers'
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers'

export class Hardhat {
    static async mainSigner() {
        return (await hre.ethers.getSigners())[0]
    }

    static balanceOf(user: SignerWithAddress | Wallet) {
        return hre.ethers.provider.getBalance(user.address)
    }

    static parseEther(amount: number | string) {
        return hre.ethers.parseEther(
            typeof amount === 'number'
                ? amount.toString()
                : amount,
        )
    }

    static async awaitConfirmation(
        transaction: TransactionResponse | Promise<TransactionResponse>,
        wait = 1,
    ) {
        const awaitedTransaction = await transaction

        const network = hre.network.name

        if (network !== 'hardhat' && network !== 'localhost')
            await awaitedTransaction.wait(wait)

        return awaitedTransaction
    }

    static async gasPrice() {
        const feeData = await hre.ethers.provider.getFeeData()
        const gasPrice = feeData.gasPrice

        if (!gasPrice)
            return 0n

        return gasPrice + (gasPrice * 10n / 100n)
    }

    static async transferAllFunds(from: SignerWithAddress | Wallet, to: SignerWithAddress | Wallet) {
        const gasPrice = await this.gasPrice()
        const gasLimit = await hre.ethers.provider.estimateGas({
            from: from.address,
            to: to.address,
            gasPrice: gasPrice,
        })
        const gasCost = gasLimit * gasPrice
        const value = await Hardhat.balanceOf(from) - gasCost

        if (value > 0) {
            await this.awaitConfirmation(
                from.sendTransaction({
                    to: to.address,
                    gasPrice,
                    gasLimit,
                    value,
                }),
                2,
            )
        }
        else {
            console.error('Error when transferring funds | insufficient balance')
        }
    }

    static async isContract(address: string) {
        const deployedBytecode = await hre.ethers.provider.getCode(address)

        return deployedBytecode !== '0x'
    }

    static async chainId() {
        return (await hre.ethers.provider.getNetwork()).chainId
    }
}
