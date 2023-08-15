import { utils } from 'ethers'
import { Bytecode } from './Bytecode'
import { CommandBuilder } from './CommandBuilder'
import { ConstructorArgument } from './helpers/types'
import { Matcher } from './Matcher'
import { Storage, StorageType } from './Storage'

export class Salt {
    public constructor(
        public readonly matcher: Matcher,
        public readonly deployer: string,
    ) {
    }

    public async getImplementationSalt(
        contractName: string,
        {
            constructorArguments,
            saveAs = contractName,
        }: {
            constructorArguments?: ConstructorArgument[],
            saveAs?: string
        } = {},
    ) {
        const saltKey = saveAs + ':salt'

        let salt = await Storage.findSecret(saltKey)

        if (salt)
            return salt

        const { filename } = await Bytecode.generate(contractName, {
            constructorArguments,
        })

        salt = await CommandBuilder.eradicate(
            this.deployer,
            filename,
            this.matcher,
        )

        await Storage.save({ type: StorageType.SECRET, name: saltKey, value: salt })

        return salt
    }

    public async getProxySalt(
        contractName: string,
        implementationAddress: string,
        {
            saveAs = contractName,
        }: {
            saveAs?: string
        } = {},
    ) {
        return this.getImplementationSalt(
            'ERC1967Proxy',
            {
                constructorArguments: [
                    implementationAddress,
                    [],
                ],
                saveAs: saveAs + 'Proxy',
            },
        )
    }

    public computeAddress(initCode: string, salt: string) {
        const computedHash = utils.solidityKeccak256(
            ['bytes1', 'address', 'bytes32', 'bytes32'],
            ['0xff', this.deployer, salt, utils.keccak256(initCode)],
        )

        return `0x${ computedHash.slice(-40) }`
    }
}
