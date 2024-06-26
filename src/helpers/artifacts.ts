import ERC1967Proxy from '@openzeppelin/upgrades-core/artifacts/@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol/ERC1967Proxy.json'
import UpgradesBuildInfo from '@openzeppelin/upgrades-core/artifacts/build-info.json'

import VanityDeployer from '../../artifacts/contracts/VanityDeployer.sol/VanityDeployer.json'
import VanityDeployerBuildInfo from '../../artifacts/build-info/e3d97e423946aba795cb81d44a21c837.json'

export const ERC1967ProxyArtifact = ERC1967Proxy
export const UpgradesBuildInfoArtifact = UpgradesBuildInfo

export const VanityDeployerArtifact = VanityDeployer
export const VanityDeployerBuildInfoArtifact = VanityDeployerBuildInfo

export type BuildInfo = typeof UpgradesBuildInfoArtifact | typeof VanityDeployerBuildInfoArtifact
