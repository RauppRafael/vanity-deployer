import { subtask } from 'hardhat/config'

function tryRequire(id: string) {
    try {
        require(id)

        return true
    }
    catch (e: any) {
        // do nothing
    }

    return false
}

if (tryRequire('@nomiclabs/hardhat-etherscan')) {
    subtask('verify:verify').setAction(async (args, hre, runSuper) => {
        const { verify } = await import('./src/helpers/verify-proxy')

        return await verify(args, hre, runSuper)
    })
}

export * from './src/helpers/Deployer'
export * from './src/helpers/Storage'
export * from './src/helpers/Verify'
export * from './src/helpers/CommandBuilder'
export * from './src/helpers/Bytecode'
