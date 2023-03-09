import {
    getVerificationStatus,
    verifyContract,
} from '@nomiclabs/hardhat-etherscan/dist/src/etherscan/EtherscanService'
import {
    toCheckStatusRequest,
    toVerifyRequest,
} from '@nomiclabs/hardhat-etherscan/dist/src/etherscan/EtherscanVerifyContractRequest'
import {
    resolveEtherscanApiKey,
} from '@nomiclabs/hardhat-etherscan/dist/src/resolveEtherscanApiKey'
import { EtherscanConfig } from '@nomiclabs/hardhat-etherscan/dist/src/types'
import hre from 'hardhat'
import { request } from 'undici'
import { BuildInfoArtifact } from '../../artifacts'
import { sleep } from '../../sleep'
import { ContractArtifact } from '../interfaces'
import { EtherscanAPIConfig, EtherscanResponseBody, RESPONSE_OK } from './interfaces'

export class Etherscan {
    public static async requestEtherscanVerification(
        contractAddress: string,
        artifact: ContractArtifact,
        constructorArguments: string,
    ) {
        const etherscanApi = await Etherscan._getEtherscanAPIConfig()
        const request = toVerifyRequest({
            apiKey: etherscanApi.key,
            contractAddress,
            sourceCode: JSON.stringify(BuildInfoArtifact.input),
            sourceName: artifact.sourceName,
            contractName: artifact.contractName,
            compilerVersion: `v${ BuildInfoArtifact.solcLongVersion }`,
            constructorArguments: constructorArguments,
        })

        try {
            const response = await verifyContract(etherscanApi.endpoints.urls.apiURL, request)
            const statusRequest = toCheckStatusRequest({
                apiKey: etherscanApi.key,
                guid: response.message,
            })
            const status = await getVerificationStatus(etherscanApi.endpoints.urls.apiURL, statusRequest)

            if (status.isVerificationSuccess())
                console.info(`Successfully verified contract ${ artifact.contractName } at ${ contractAddress }.`)
            else
                console.error('verification failed')
        }
        catch (e) {
            const error = e as Error

            if (error.message.toLowerCase().includes('already verified'))
                return console.log(`Contract at ${ contractAddress } already verified.`)

            console.error({
                contractAddress,
                contractName: artifact.contractName,
                message: error.message,
                error,
            })

            throw new Error('Verification failed')
        }
    }

    /**
     * Calls the Etherscan API to link a proxy with its implementation.
     *
     * @param proxyAddress The proxy address
     * @param implAddress The implementation address
     */
    public static async linkProxyWithImplementation(
        proxyAddress: string,
        implAddress: string,
    ) {
        console.info(`Linking proxy ${ proxyAddress } with implementation`)

        const etherscanApi = await Etherscan._getEtherscanAPIConfig()
        let responseBody = await Etherscan._callEtherscanApi(etherscanApi, {
            module: 'contract',
            action: 'verifyproxycontract',
            address: proxyAddress,
            expectedimplementation: implAddress,
        })

        if (responseBody.status === RESPONSE_OK) {
            // initial call was OK, but need to send a status request using the returned guid to get the actual verification status
            const guid = responseBody.result

            responseBody = await Etherscan.checkProxyVerificationStatus(etherscanApi, guid)

            while (responseBody.result === 'Pending in queue') {
                await sleep(3000)

                responseBody = await Etherscan.checkProxyVerificationStatus(etherscanApi, guid)
            }
        }

        if (responseBody.status === RESPONSE_OK)
            console.log('Successfully linked proxy to implementation.')
        else
            throw new Error(`Failed to link proxy ${ proxyAddress } with its implementation. Reason: ${ responseBody.result }`)
    }

    public static async checkProxyVerificationStatus(etherscanApi: EtherscanAPIConfig, guid: string) {
        return await Etherscan._callEtherscanApi(etherscanApi, {
            module: 'contract',
            action: 'checkproxyverification',
            apikey: etherscanApi.key,
            guid: guid,
        })
    }

    /**
     * Call the configured Etherscan API with the given parameters.
     *
     * @param etherscanApi The Etherscan API config
     * @param params The API parameters to call with
     * @returns The Etherscan API response
     */
    private static async _callEtherscanApi(
        etherscanApi: EtherscanAPIConfig,
        params: any,
    ): Promise<EtherscanResponseBody> {
        const parameters = new URLSearchParams({ ...params, apikey: etherscanApi.key })

        const response = await request(etherscanApi.endpoints.urls.apiURL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: parameters.toString(),
        })

        if (!(response.statusCode >= 200 && response.statusCode <= 299)) {
            const responseBodyText = await response.body.text()

            throw new Error(
                `Etherscan API call failed with status ${ response.statusCode }, response: ${ responseBodyText }`,
            )
        }

        return await response.body.json()
    }

    /**
     * Gets the Etherscan API parameters from Hardhat config.
     * Makes use of Hardhat Etherscan for handling cases when Etherscan API parameters are not present in config.
     */
    private static async _getEtherscanAPIConfig(): Promise<EtherscanAPIConfig> {
        const endpoints = await hre.run('verify:get-etherscan-endpoint')
        const etherscanConfig: EtherscanConfig = (hre.config as any).etherscan
        const key = resolveEtherscanApiKey(etherscanConfig.apiKey, endpoints.network)

        return { key, endpoints }
    }
}

