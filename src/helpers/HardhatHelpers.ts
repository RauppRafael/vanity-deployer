import hre from 'hardhat'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { Wallet } from 'ethers'

export class HardhatHelpers {
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

    static async sendTransaction(tx, wait = 1) {
        tx = await tx

        const network = process?.env?.HARDHAT_NETWORK

        if (network !== 'hardhat' && network !== 'localhost')
            await tx.wait(wait)

        return tx
    }

    static async transferAllFunds(from: SignerWithAddress | Wallet, to: SignerWithAddress | Wallet) {
        const { gasPrice } = await hre.ethers.provider.getFeeData()

        await this.sendTransaction(
            from.sendTransaction({
                to: to.address,
                gasPrice,
                gasLimit: 21000,
                value: (await HardhatHelpers.balanceOf(from))
                    .sub(hre.ethers.BigNumber.from(21000).mul(gasPrice)),
            }),
            2,
        )
    }
}
