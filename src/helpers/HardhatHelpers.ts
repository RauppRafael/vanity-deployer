import hre from 'hardhat'

export class HardhatHelpers {
    static parseEther(amount: number | string) {
        return hre.ethers.utils.parseEther(
            typeof amount === 'number'
                ? amount.toString()
                : amount,
        )
    }

    static getBlock() {
        return hre.ethers.provider.getBlock('latest')
    }

    static async sendTransaction(tx, wait = 1) {
        tx = await tx

        const network = process?.env?.HARDHAT_NETWORK

        if (network !== 'hardhat' && network !== 'localhost')
            await tx.wait(wait)

        return tx
    }
}
