// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.0;

import "./OwnableUpgradeable.sol";

contract Deployer is OwnableUpgradeable {
    event DeployedContract(address indexed contractAddress, bool proxy);

    function initialize(address _owner) initializer virtual public {
        __Ownable_init();

        transferOwnership(_owner);
    }

    function deployContract(bytes memory code, bytes32 salt) public onlyOwner {
        address addr;

        assembly {
            addr := create2(0, add(code, 0x20), mload(code), salt)
            if iszero(extcodesize(addr)) {revert(0, 0)}
        }

        emit DeployedContract(addr, false);
    }

    function deployProxy(
        bytes memory code,
        bytes32 salt,
        bytes memory initializer
    ) public onlyOwner {
        address addr;

        assembly {
            addr := create2(0, add(code, 0x20), mload(code), salt)
            if iszero(extcodesize(addr)) {revert(0, 0)}
        }

        (bool success,) = addr.call(initializer);

        require(success, "Deployer:: Proxy initialization failed");

        emit DeployedContract(addr, true);
    }
}
