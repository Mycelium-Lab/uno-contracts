// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
interface IChildChainStreamer {
    function reward_count() external view returns(uint256);
    function reward_tokens(uint256) external view returns(IERC20);
}