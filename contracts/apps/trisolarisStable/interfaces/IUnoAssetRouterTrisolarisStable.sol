// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import { IUnoFarmTrisolarisStable as Farm } from "./IUnoFarmTrisolarisStable.sol";
import '../../../interfaces/IUnoFarmFactory.sol';
import '../../../interfaces/IUnoAccessManager.sol'; 
import '@openzeppelin/contracts/token/ERC20/IERC20.sol';

interface IUnoAssetRouterTrisolarisStable {
    event Deposit(address indexed lpPool, address indexed sender, address indexed recipient, uint256 amount);
    event Withdraw(address indexed lpPool, address indexed sender, address indexed recipient, uint256 amount);
    event Distribute(address indexed lpPool, uint256 reward);

    event FeeChanged(uint256 previousFee, uint256 newFee);

    error CALLER_NOT_AUTHORIZED();
    error INVALID_ACCESS_MANAGER();
    error INVALID_FARM_FACTORY();
    error INVALID_MSG_VALUE();
    error INVALID_SWAP_DESCRIPTION();
    error INVALID_AMOUNT_LENGTH(uint256 tokenLength);
    error INVALID_MIN_AMOUNTS_LENGTH(uint256 tokenLength);
    error INVALID_SWAP_DATA_LENGTH(uint256 tokenLength);
    error ETH_DEPOSIT_REJECTED();
    error NO_TOKENS_SENT();
    error NO_TOKENS_IN_SWAP();
    error NOT_ETH_FARM();
    error FARM_NOT_EXISTS();
    error SWAP_NOT_SUCCESSFUL();
    error TRANSFER_NOT_SUCCESSFUL();
    error NO_LIQUIDITY_PROVIDED();
    error MAX_FEE_EXCEEDED(uint256 maxFee);
    error INSUFFICIENT_AMOUNT();

    function farmFactory() external view returns(IUnoFarmFactory);
    function accessManager() external view returns(IUnoAccessManager);
    function fee() external view returns(uint256);

    function WETH() external view returns(address);

    function initialize(address _accessManager, address _farmFactory) external;

    function deposit(address swap, uint256[] memory amounts, uint256 minAmountLP, address recipient) external returns (uint256 liquidity);
    function depositETH(address swap, uint256[] memory amounts, uint256 minAmountLP, address recipient) external payable returns(uint256 liquidity);
    function depositWithSwap(address swap, bytes[] calldata swapData, uint256 minAmountLP, address recipient) external payable returns(uint256[] memory sent, uint256 liquidity);
    function depositLP(address swap, uint256 amount, address recipient) external;

    function withdraw(address swap, uint256 amount, uint256[] calldata minAmounts, address recipient) external returns (uint256[] memory amounts);
    function withdrawETH(address swap, uint256 amount, uint256[] calldata minAmounts, address recipient) external returns(uint256[] memory amounts);
    function withdrawWithSwap(address swap, uint256 amount, bytes[] calldata swapData, address recipient) external returns(uint256[] memory amounts, uint256[] memory dust);
    function withdrawLP(address swap, uint256 amount, address recipient) external;

    function distribute(
        address swap,
        Farm.SwapInfo[] calldata rewardSwapInfos,
        Farm.SwapInfo[] calldata rewarderSwapInfos,
        address feeTo
    ) external returns(uint256 reward);

    function userStake(address _address, address swap) external view returns (uint256 stakeLP);
    function totalDeposits(address swap) external view returns (uint256 totalDepositsLP);
    function getTokens(address swap) external view returns(IERC20[] memory tokens);

    function setFee(uint256 _fee) external;

    function pause() external;
    function unpause() external;
}
