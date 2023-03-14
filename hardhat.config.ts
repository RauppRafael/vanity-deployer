import '@typechain/hardhat'
import '@nomiclabs/hardhat-ethers'

const getVersionBase = (version: string) => ({
    version,
    settings: {
        optimizer: {
            enabled: true,
            runs: 2_000,
        },
    },
})

module.exports = {
    solidity: getVersionBase('0.8.18'),
    paths: {
        sources: './contracts',
    },
    typechain: {
        outDir: 'src/types',
        target: 'ethers-v5',
    },
}

