import { BigNumber } from 'ethers'

export type ConstructorArgument =
    boolean
    | number
    | string
    | BigNumber
    | (boolean | number | string | BigNumber)[]
