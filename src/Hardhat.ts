import hre from 'hardhat'
import { BigNumber, Wallet } from 'ethers'
import { TransactionResponse } from '@ethersproject/abstract-provider'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

export class Hardhat {
    static async mainSigner() {
        return (await hre.ethers.getSigners())[0]
    }

    static balanceOf(user: SignerWithAddress | Wallet) {
        return hre.ethers.provider.getBalance(user.address)
    }

    static parseEther(amount: number | string) {
        return hre.ethers.utils.parseEther(
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
            return BigNumber.from('0')

        return gasPrice.add(gasPrice.mul(10).div(100))
    }

    static async transferAllFunds(from: SignerWithAddress | Wallet, to: SignerWithAddress | Wallet) {
        const gasPrice = await this.gasPrice()

        await this.awaitConfirmation(
            from.sendTransaction({
                to: to.address,
                gasPrice,
                gasLimit: 21000,
                value: (await Hardhat.balanceOf(from))
                    .sub(hre.ethers.BigNumber.from(21000).mul(gasPrice)),
            }),
            2,
        )
    }

    static async isContract(address: string) {
        const deployedBytecode = await hre.ethers.provider.getCode(address)

        return deployedBytecode !== '0x'
    }
}
