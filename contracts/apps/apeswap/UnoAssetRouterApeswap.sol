// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import {IUnoFarmApeswap as Farm} from './interfaces/IUnoFarmApeswap.sol'; 
import '../../interfaces/IUnoFarmFactory.sol';
import '../../interfaces/IUnoAccessManager.sol'; 
import '../../interfaces/IUniswapV2Pair.sol';
import '../../interfaces/IWMATIC.sol';
import '@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol';
import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import '@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol';
import '@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol';
import '@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol';
import '@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol';

contract UnoAssetRouterApeswap is Initializable, PausableUpgradeable, UUPSUpgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    /**
     * @dev Contract Variables:
     * farmFactory - The contract that deploys new Farms and links them to {lpPair}s.
     * accessManager - Role manager contract.
     */
    IUnoFarmFactory public farmFactory;
    IUnoAccessManager public accessManager;

    bytes32 private constant DISTRIBUTOR_ROLE = keccak256('DISTRIBUTOR_ROLE');
    bytes32 private constant PAUSER_ROLE = keccak256('PAUSER_ROLE');

    uint256 public fee;

    address public constant WMATIC = 0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270;
    address private constant oneInchRouter = 0x1111111254EEB25477B68fb85Ed929f73A960582;

    event Deposit(address indexed lpPool, address indexed sender, address indexed recipient, uint256 amount);
    event Withdraw(address indexed lpPool, address indexed sender, address indexed recipient, uint256 amount);
    event Distribute(address indexed lpPool, uint256 reward);
    
    event FeeChanged(uint256 previousFee, uint256 newFee);

    modifier onlyRole(bytes32 role){
        require(accessManager.hasRole(role, msg.sender), 'CALLER_NOT_AUTHORIZED');
        _;
    }

    // ============ Methods ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _accessManager, address _farmFactory) external initializer{
        require (_accessManager != address(0), 'BAD_ACCESS_MANAGER');
        require (_farmFactory != address(0), 'BAD_FARM_FACTORY');

        __Pausable_init();
        accessManager = IUnoAccessManager(_accessManager);
        farmFactory = IUnoFarmFactory(_farmFactory);
    }

    receive() external payable {
        require(msg.sender == WMATIC, 'ONLY_ACCEPT_WMATIC'); // only accept ETH via fallback from the WMATIC contract
    }

    /**
     * @dev Deposits tokens in the given pool. Creates new Farm contract if there isn't one deployed for the {lpPair} and deposits tokens in it. Emits a {Deposit} event.
     * @param lpPair - Address of the pool to deposit tokens in.
     * @param amountA  - Token A amount to deposit.
     * @param amountB -  Token B amount to deposit.
     * @param amountAMin - Bounds the extent to which the B/A price can go up before the transaction reverts.
     * @param amountBMin - Bounds the extent to which the A/B price can go up before the transaction reverts.
     * @param amountLP - Additional LP Token amount to deposit.
     * @param recipient - Address which will receive the deposit.
     
     * @return sentA - Token A amount sent to the farm.
     * @return sentB - Token B amount sent to the farm.
     * @return liquidity - Total liquidity sent to the farm (in lpTokens).
     */
    function deposit(address lpPair, uint256 amountA, uint256 amountB, uint256 amountAMin, uint256 amountBMin, uint256 amountLP, address recipient) external whenNotPaused returns(uint256 sentA, uint256 sentB, uint256 liquidity){
        Farm farm = Farm(farmFactory.Farms(lpPair));
        if(farm == Farm(address(0))){
            farm = Farm(farmFactory.createFarm(lpPair));
        }

        if(amountLP > 0){
            IERC20Upgradeable(lpPair).safeTransferFrom(msg.sender, address(farm), amountLP);
        }
        if(amountA > 0){
            IERC20Upgradeable(farm.tokenA()).safeTransferFrom(msg.sender, address(farm), amountA);
        }
        if(amountB > 0){
            IERC20Upgradeable(farm.tokenB()).safeTransferFrom(msg.sender, address(farm), amountB);
        }

        (sentA, sentB, liquidity) = farm.deposit(amountA, amountB, amountAMin, amountBMin, amountLP, msg.sender, recipient);
        emit Deposit(lpPair, msg.sender, recipient, liquidity); 
    }

    /**
     * @dev Autoconverts MATIC into WMATIC and deposits tokens in the given pool. Creates new Farm contract if there isn't one deployed for the {lpStakingPool} and deposits tokens in it. Emits a {Deposit} event.
     * @param lpPair - Address of the pool to deposit tokens in.
     * @param amountToken  - Token amount to deposit.
     * @param amountTokenMin - Bounds the extent to which the TOKEN/WMATIC price can go up before the transaction reverts.
     * @param amountETHMin - Bounds the extent to which the WMATIC/TOKEN price can go up before the transaction reverts.
     * @param amountLP - Additional LP Token amount to deposit.
     * @param recipient - Address which will receive the deposit.
     
     * @return sentToken - Token amount sent to the farm.
     * @return sentETH - WMATIC amount sent to the farm.
     * @return liquidity - Total liquidity sent to the farm (in lpTokens).
     */
    function depositETH(address lpPair, uint256 amountToken, uint256 amountTokenMin, uint256 amountETHMin, uint256 amountLP, address recipient) external payable whenNotPaused returns(uint256 sentToken, uint256 sentETH, uint256 liquidity){
        require(msg.value > 0, "NO_MATIC_SENT");
        Farm farm = Farm(farmFactory.Farms(lpPair));
        if(farm == Farm(address(0))){
            farm = Farm(farmFactory.createFarm(lpPair));
        }

        if(amountLP > 0){
            IERC20Upgradeable(lpPair).safeTransferFrom(msg.sender, address(farm), amountLP);
        }

        address tokenA = farm.tokenA();
        address tokenB = farm.tokenB();

        IWMATIC(WMATIC).deposit{value: msg.value}();
        IERC20Upgradeable(WMATIC).safeTransfer(address(farm), msg.value);
        if (tokenA == WMATIC) {
            if (amountToken > 0) {
                IERC20Upgradeable(tokenB).safeTransferFrom(msg.sender, address(farm), amountToken);
            }
            (sentETH, sentToken, liquidity) = farm.deposit(msg.value, amountToken, amountETHMin, amountTokenMin, amountLP, address(this), recipient);
            IERC20Upgradeable(tokenB).safeTransfer(msg.sender, amountToken - sentToken);
        } else if (tokenB == WMATIC) {
            if (amountToken > 0) {
                IERC20Upgradeable(tokenA).safeTransferFrom(msg.sender, address(farm), amountToken);
            }
            (sentToken, sentETH, liquidity) = farm.deposit(amountToken, msg.value, amountTokenMin, amountETHMin, amountLP, address(this), recipient);
            IERC20Upgradeable(tokenA).safeTransfer(msg.sender, amountToken - sentToken);
        } else {
            revert("NOT_WMATIC_POOL");
        }

        uint256 dust = msg.value - sentETH;
        if (dust > 0){
            IWMATIC(WMATIC).withdraw(dust);
            payable(msg.sender).transfer(dust);
        }
        emit Deposit(lpPair, msg.sender, recipient, liquidity);
    }

    /**
     * @dev Deposits single token in the given pool. Creates new Farm contract if there isn't one deployed for the {lpPair}, swaps {token} for pool tokens and deposits them. Emits a {Deposit} event.
     * @param lpPair - Address of the pool to deposit tokens in.
     * @param token  - Address of a token to enter the pool.
     * @param amount - Amount of token sent.
     * @param swapData - Parameter with which 1inch router is being called with.
     * @param amountAMin - Bounds the extent to which the B/A price can go up before the transaction reverts.
     * @param amountBMin - Bounds the extent to which the A/B price can go up before the transaction reverts.
     * @param amountLP - Additional LP Token amount to deposit.
     * @param recipient - Address which will receive the deposit.
     
     * @return sent - Total {token} amount sent to the farm. NOTE: Returns dust left from swap in {token}, but if A/B amounts are not correct also returns dust in pool's tokens.
     * @return liquidity - Total liquidity sent to the farm (in lpTokens).
     */
    function depositSingleAsset(address lpPair, address token, uint256 amount, bytes[2] calldata swapData, uint256 amountAMin, uint256 amountBMin, uint256 amountLP, address recipient) external whenNotPaused returns(uint256 sent, uint256 liquidity){
        require(amount > 0, "NO_TOKEN_SENT");
        Farm farm = Farm(farmFactory.Farms(lpPair));
        if(farm == Farm(address(0))){
            farm = Farm(farmFactory.createFarm(lpPair));
        }

        sent = amount;
        uint256 amountA;
        uint256 amountB;
        address tokenA = farm.tokenA();
        address tokenB = farm.tokenB();

        IERC20Upgradeable(token).safeTransferFrom(msg.sender, address(this), amount);
        IERC20Upgradeable(token).approve(oneInchRouter, amount);
        if (tokenA != token) {
            (uint256 returnAmount, uint256 spentAmount) = _swap(swapData[0]);
            amount -= spentAmount;
            amountA = returnAmount;
        }
        if (tokenB != token) {
            (uint256 returnAmount, uint256 spentAmount) = _swap(swapData[1]);
            amount -= spentAmount;
            amountB = returnAmount;
        }

        if (tokenA == token) {
            amountA = amount;
        } else if (tokenB == token) {
            amountB = amount;
        } else if(amount > 0) {
            sent -= amount;
            IERC20Upgradeable(token).safeTransfer(msg.sender, amount);
        }

        if(amountLP > 0){
            IERC20Upgradeable(farm.lpPair()).safeTransferFrom(msg.sender, address(farm), amountLP);
        }
        if(amountA > 0){
            IERC20Upgradeable(tokenA).safeTransfer(address(farm), amountA);
        }
        if(amountB > 0){
            IERC20Upgradeable(tokenB).safeTransfer(address(farm), amountB);
        }

        (,,liquidity) = farm.deposit(amountA, amountB, amountAMin, amountBMin, amountLP, msg.sender, recipient);
        emit Deposit(lpPair, msg.sender, recipient, liquidity);
    }

    /**
     * @dev Deposits single MATIC in the given pool. Creates new Farm contract if there isn't one deployed for the {lpPair}, swaps MATIC for pool tokens and deposits them. Emits a {Deposit} event.
     * @param lpPair - Address of the pool to deposit tokens in.
     * @param swapData - Parameter with which 1inch router is being called with.
     * @param amountAMin - Bounds the extent to which the B/A price can go up before the transaction reverts.
     * @param amountBMin - Bounds the extent to which the A/B price can go up before the transaction reverts.
     * @param amountLP - Additional LP Token amount to deposit.
     * @param recipient - Address which will receive the deposit.
     
     * @return sentETH - Total MATIC amount sent to the farm. NOTE: Returns dust left from swap in MATIC, but if A/B amount are not correct also returns dust in pool's tokens.
     * @return liquidity - Total liquidity sent to the farm (in lpTokens).
     */
    function depositSingleETH(address lpPair, bytes[2] calldata swapData, uint256 amountAMin, uint256 amountBMin, uint256 amountLP, address recipient) external payable whenNotPaused returns(uint256 sentETH, uint256 liquidity){
        require(msg.value > 0, "NO_MATIC_SENT");
        Farm farm = Farm(farmFactory.Farms(lpPair));
        if(farm == Farm(address(0))){
            farm = Farm(farmFactory.createFarm(lpPair));
        }

        uint256 amount = msg.value;
        sentETH = amount;
        uint256 amountA;
        uint256 amountB;
        address tokenA = farm.tokenA();
        address tokenB = farm.tokenB();

        IWMATIC(WMATIC).deposit{value: amount}();
        IERC20Upgradeable(WMATIC).approve(oneInchRouter, amount);
        if (tokenA != WMATIC) {
            (uint256 returnAmount, uint256 spentAmount) = _swap(swapData[0]);
            amount -= spentAmount;
            amountA = returnAmount;
        }
        if (tokenB != WMATIC) {
            (uint256 returnAmount, uint256 spentAmount) = _swap(swapData[1]);
            amount -= spentAmount;
            amountB = returnAmount;
        }

        if (tokenA == WMATIC) {
            amountA = amount;
        } else if (tokenB == WMATIC) {
            amountB = amount;
        } else if (amount > 0) {
            IWMATIC(WMATIC).withdraw(amount);
            payable(msg.sender).transfer(amount);
            sentETH -= amount;
        }

        if(amountLP > 0){
            IERC20Upgradeable(farm.lpPair()).safeTransferFrom(msg.sender, address(farm), amountLP);
        }
        if(amountA > 0){
            IERC20Upgradeable(tokenA).safeTransfer(address(farm), amountA);
        }
        if(amountB > 0){
            IERC20Upgradeable(tokenB).safeTransfer(address(farm), amountB);
        }

        (,,liquidity) = farm.deposit(amountA, amountB, amountAMin, amountBMin, amountLP, msg.sender, recipient);
        emit Deposit(lpPair, msg.sender, recipient, liquidity);
    }

    /** 
     * @dev Withdraws tokens from the given pool. Emits a {Withdraw} event.
     * @param lpPair - LP pool to withdraw from.
     * @param amount - LP amount to withdraw. 
     * @param amountAMin - The minimum amount of tokenA that must be received for the transaction not to revert.
     * @param amountBMin - The minimum amount of tokenB that must be received for the transaction not to revert.
     * @param withdrawLP - True: Withdraw in LP tokens, False: Withdraw in normal tokens.
     * @param recipient - The address which will receive tokens.

     * @return amountA - Token A amount sent to the {recipient}, 0 if withdrawLP == false.
     * @return amountB - Token B amount sent to the {recipient}, 0 if withdrawLP == false.
     */ 
    function withdraw(address lpPair, uint256 amount, uint256 amountAMin, uint256 amountBMin, bool withdrawLP, address recipient) external returns(uint256 amountA, uint256 amountB){
        Farm farm = Farm(farmFactory.Farms(lpPair));
        require(farm != Farm(address(0)),'FARM_NOT_EXISTS');
        
        (amountA, amountB) = farm.withdraw(amount, amountAMin, amountBMin, withdrawLP, msg.sender, recipient);
        emit Withdraw(lpPair, msg.sender, recipient, amount);  
    }

    /** 
     * @dev Autoconverts WMATIC into MATIC and withdraws tokens from the pool. Emits a {Withdraw} event.
     * @param lpPair - LP pool to withdraw from.
     * @param amount - LP amount to withdraw. 
     * @param amountTokenMin - The minimum amount of token that must be received for the transaction not to revert.
     * @param amountETHMin - The minimum amount of MATIC that must be received for the transaction not to revert.
     * @param recipient - The address which will receive tokens.

     * @return amountToken - Token amount sent to the {recipient}.
     * @return amountETH - MATIC amount sent to the {recipient}.
     */ 
    function withdrawETH(address lpPair, uint256 amount, uint256 amountTokenMin, uint256 amountETHMin, address recipient) external returns(uint256 amountToken, uint256 amountETH){
        Farm farm = Farm(farmFactory.Farms(lpPair));
        require(farm != Farm(address(0)),'FARM_NOT_EXISTS');

        address tokenA = farm.tokenA();
        address tokenB = farm.tokenB();

        if (tokenA == WMATIC) {
            (amountETH, amountToken) = farm.withdraw(amount, amountETHMin, amountTokenMin, false, msg.sender, address(this));
            IERC20Upgradeable(tokenB).safeTransfer(recipient, amountToken);
        } else if (tokenB == WMATIC) {
            (amountToken, amountETH) = farm.withdraw(amount, amountTokenMin, amountETHMin, false, msg.sender, address(this)); 
            IERC20Upgradeable(tokenA).safeTransfer(recipient, amountToken);
        } else {
            revert("NOT_WMATIC_POOL");
        }

        IWMATIC(WMATIC).withdraw(amountETH);
        payable(recipient).transfer(amountETH);
        emit Withdraw(lpPair, msg.sender, recipient, amount);
    }

    /**
     * @dev Distributes tokens between users.
     * @param lpPair - LP pool to distribute tokens in.
     * @param swapInfos - Arrays of structs with token arrays describing swap routes (rewardTokenToTokenA, rewardTokenToTokenB, rewarderTokenToTokenA, rewarderTokenToTokenB) and minimum amounts of output tokens that must be received for the transaction not to revert.
     * @param feeSwapInfos - Arrays of structs with token arrays describing swap routes (rewardTokenToFeeToken, rewarderTokenToFeeToken) and minimum amounts of output tokens that must be received for the transaction not to revert.
     * @param feeTo - Address to collect fees to.
     *
     * Note: This function can only be called by the distributor.
     */ 
    function distribute(
        address lpPair,
        Farm.SwapInfo[4] calldata swapInfos,
        Farm.SwapInfo[2] calldata feeSwapInfos,
        address feeTo
    ) external whenNotPaused onlyRole(DISTRIBUTOR_ROLE) {
        Farm farm = Farm(farmFactory.Farms(lpPair));
        require(farm != Farm(address(0)), 'FARM_NOT_EXISTS');

        uint256 reward = farm.distribute(swapInfos, feeSwapInfos, Farm.FeeInfo(feeTo, fee));
        emit Distribute(lpPair, reward);
    }

    /**
     * @dev Returns tokens staked by the {_address} for the given {lpPair}.
     * @param _address - The address to check stakes for.
     * @param lpPair - LP pool to check stakes in.

     * @return stakeLP - Total user stake(in LP tokens).
     * @return stakeA - Token A stake.
     * @return stakeB - Token B stake.
     */
    function userStake(address _address, address lpPair) external view returns (uint256 stakeLP, uint256 stakeA, uint256 stakeB) {
        Farm farm = Farm(farmFactory.Farms(lpPair));
        if (farm != Farm(address(0))) {
            stakeLP = farm.userBalance(_address);
            (stakeA, stakeB) = _getTokenStake(lpPair, stakeLP);
        }
    }

    /**
     * @dev Returns total amount locked in the pool. Doesn't take pending rewards into account.
     * @param lpPair - LP pool to check total deposits in.

     * @return totalDepositsLP - Total deposits (in LP tokens).
     * @return totalDepositsA - Token A deposits.
     * @return totalDepositsB - Token B deposits.
     */  
    function totalDeposits(address lpPair) external view returns (uint256 totalDepositsLP, uint256 totalDepositsA, uint256 totalDepositsB) {
        Farm farm = Farm(farmFactory.Farms(lpPair));
        if (farm != Farm(address(0))) {
            totalDepositsLP = farm.getTotalDeposits(); 
            (totalDepositsA, totalDepositsB) = _getTokenStake(lpPair, totalDepositsLP);
        }
    }

    /**
     * @dev Returns addresses of tokens in {lpPair}.
     * @param lpPair - LP pair to check tokens in.

     * @return tokens - Tokens addresses.
     */  
    function getTokens(address lpPair) external view returns(IERC20[] memory tokens){
        tokens = new IERC20[](2);
        tokens[0] = IERC20(IUniswapV2Pair(lpPair).token0());
        tokens[1] = IERC20(IUniswapV2Pair(lpPair).token1());
    }

    /**
     * @dev Swaps assets using 1inch exchange.
     */  
    function _swap(bytes calldata swapData) internal returns(uint256 returnAmount, uint256 spentAmount){
        (bool success, bytes memory data) = oneInchRouter.call(swapData);
        require(success, "SWAP_NOT_SUCCESSFUL");
        (returnAmount, spentAmount) = abi.decode(data, (uint256, uint256));
    }

    /**
     * @dev Converts LP tokens to normal tokens, value(amountA) == value(amountB) == 0.5*amountLP
     * @param lpPair - LP pair for conversion.
     * @param amountLP - Amount of LP tokens to convert.

     * @return amountA - Token A amount.
     * @return amountB - Token B amount.
     */ 
    function _getTokenStake(address lpPair, uint256 amountLP) internal view returns (uint256 amountA, uint256 amountB) {
        uint256 totalSupply = IERC20Upgradeable(lpPair).totalSupply();
        amountA = amountLP * IERC20Upgradeable(IUniswapV2Pair(lpPair).token0()).balanceOf(lpPair) / totalSupply;
        amountB = amountLP * IERC20Upgradeable(IUniswapV2Pair(lpPair).token1()).balanceOf(lpPair) / totalSupply;
    }

    /**
     * @dev Change fee amount.
     * @param _fee -New fee to collect from farms. [10^18 == 100%]
     *
     * Note: This function can only be called by ADMIN_ROLE.
     */ 
    function setFee(uint256 _fee) external onlyRole(accessManager.ADMIN_ROLE()){
        require (_fee <= 1 ether, "BAD_FEE");
        if(fee != _fee){
            emit FeeChanged(fee, _fee); 
            fee = _fee;
        }
    }
 
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function _authorizeUpgrade(address) internal override onlyRole(accessManager.ADMIN_ROLE()) {

    }
}
