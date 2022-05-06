// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import "../interfaces/IMiniChefV2.sol";

contract MiniChefUtils {
    IMiniChefV2 private constant MiniChef = IMiniChefV2(0x0769fd68dFb93167989C6f7254cd0D766Fb2841F);
    function getPid(address lpPair) external view returns (uint256 pid) {
        bool poolExists = false;
        for (uint256 i = 0; i < MiniChef.poolLength(); i++) {
            if (MiniChef.lpToken(i) == lpPair) {
                pid = i;
                poolExists = true;
                break;
            }
        }
        require(poolExists, "The pool with the given pair token doesn't exist");
        return pid;
    }
}