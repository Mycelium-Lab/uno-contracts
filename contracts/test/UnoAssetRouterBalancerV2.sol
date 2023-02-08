// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import {IUnoFarmBalancer as Farm} from '../apps/balancer/interfaces/IUnoFarmBalancer.sol'; 
import '../interfaces/IUnoFarmFactory.sol';
import '../interfaces/IUnoAccessManager.sol'; 
import '../interfaces/IVault.sol'; 
import "../interfaces/IBasePool.sol";
import '../interfaces/IWMATIC.sol';
import '@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol';
import '@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol';
import '@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol';
import '@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol';
import '@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol';

contract UnoAssetRouterBalancerV2 is Initializable, PausableUpgradeable, UUPSUpgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    /**
     * @dev Contract Variables:
     * farmFactory - The contract that deploys new Farms and links them to {lpPool}s.
     * accessManager - Role manager contract.
     */
    IUnoFarmFactory public farmFactory;
    IUnoAccessManager public accessManager;

    bytes32 private constant DISTRIBUTOR_ROLE = keccak256('DISTRIBUTOR_ROLE');
    bytes32 private constant PAUSER_ROLE = keccak256('PAUSER_ROLE');

    IVault constant private Vault = IVault(0xBA12222222228d8Ba445958a75a0704d566BF2C8);

    uint256 public fee;

    address public constant WMATIC = 0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270;
    address private constant OneInchRouter = 0x1111111254EEB25477B68fb85Ed929f73A960582;

    uint256 public constant version = 2;

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
     * @dev Deposits tokens in the given pool. Creates new Farm contract if there isn't one deployed for the {lpPool} and deposits tokens in it.
     * @param lpPool - Address of the pool to deposit tokens in.
     * @param amounts - Amounts of tokens to deposit.
     * @param tokens - Tokens to deposit.
     * @param minAmountLP - Minimum LP the user will receive from {tokens} deposit.
     * @param recipient - Address which will receive the deposit.

     * @return liquidity - Total liquidity sent to the farm (in lpTokens).
     */
    function deposit(address lpPool, uint256[] memory amounts, address[] calldata tokens, uint256 minAmountLP, address recipient) external whenNotPaused returns(uint256 liquidity){
        require (amounts.length == tokens.length, 'INPUT_PARAMS_LENGTHS_NOT_MATCH');
        Farm farm = Farm(farmFactory.Farms(lpPool));
        if(farm == Farm(address(0))){
            farm = Farm(farmFactory.createFarm(lpPool));
        }

        bytes32 poolId = farm.poolId();
        _checkTokens(tokens, poolId);

        for (uint256 i = 0; i < tokens.length; i++) {
            if(amounts[i] > 0){
                if(tokens[i] == lpPool){
                    amounts[i] == 0;
                    continue;
                }
                IERC20Upgradeable(tokens[i]).safeTransferFrom(msg.sender, address(this), amounts[i]);
            }
        }

        liquidity = _addLiquidity(amounts, tokens, minAmountLP, lpPool, poolId, farm);
        farm.deposit(liquidity, recipient);

        emit Deposit(lpPool, msg.sender, recipient, liquidity); 
    }

    /**
     * @dev Autoconverts MATIC into WMATIC and deposits tokens in the given pool. Creates new Farm contract if there isn't one deployed for the {lpPool} and deposits tokens in it.
     * @param lpPool - Address of the pool to deposit tokens in.
     * @param amounts - Amounts of tokens to deposit.
     * @param tokens - Tokens to deposit.
     * @param minAmountLP - Minimum LP the user will receive from {tokens} deposit.
     * @param recipient - Address which will receive the deposit.

     * @return liquidity - Total liquidity sent to the farm (in lpTokens).
     */
    function depositETH(address lpPool, uint256[] memory amounts, address[] calldata tokens, uint256 minAmountLP, address recipient) external payable whenNotPaused returns(uint256 liquidity){
        require (msg.value > 0, "NO_MATIC_SENT");
        require (amounts.length == tokens.length, 'INPUT_PARAMS_LENGTHS_NOT_MATCH');
        Farm farm = Farm(farmFactory.Farms(lpPool));
        if(farm == Farm(address(0))){
            farm = Farm(farmFactory.createFarm(lpPool));
        }

        bytes32 poolId = farm.poolId();
        _checkTokens(tokens, poolId);

        bool WMATICInTokens;
        IWMATIC(WMATIC).deposit{value: msg.value}();
        for (uint256 i = 0; i < tokens.length; i++) {
            if(tokens[i] == lpPool){
                amounts[i] == 0;
                continue;
            }
            if(tokens[i] == WMATIC){
                amounts[i] = msg.value;
                WMATICInTokens = true;
                continue;
            }
            if(amounts[i] > 0){
                IERC20Upgradeable(tokens[i]).safeTransferFrom(msg.sender, address(this), amounts[i]);
            }
        }
        require(WMATICInTokens, "NO_WMATIC_IN_TOKENS");

        liquidity = _addLiquidity(amounts, tokens, minAmountLP, lpPool, poolId, farm);
        farm.deposit(liquidity, recipient);
        
        emit Deposit(lpPool, msg.sender, recipient, liquidity); 
    }

    /**
     * @dev Deposits single token in the given pool. Creates new Farm contract if there isn't one deployed for the {lpPool}, swaps {token} for pool tokens and deposits them. Emits a {Deposit} event.
     * @param lpPool - Address of the pool to deposit tokens in.
     * @param token  - Address of a token to enter the pool.
     * @param amount - Amount of token sent.
     * @param swapData - Parameter with which 1inch router is being called with.
     * @param minAmountLP - Minimum LP the user will receive from {tokens} deposit.
     * @param recipient - Address which will receive the deposit.
     
     * @return sent - Total {token} amount sent to the farm. 
     * @return liquidity - Total liquidity sent to the farm (in lpTokens).
     */
    function depositSingleAsset(address lpPool, address token, uint256 amount, bytes[] calldata swapData, uint256 minAmountLP, address recipient) external whenNotPaused returns(uint256 sent, uint256 liquidity){
        require (amount > 0, "NO_TOKEN_SENT");
        address[] memory tokens = _convertToAddressArray(getTokens(lpPool));
        require (swapData.length == tokens.length, 'INPUT_PARAMS_LENGTHS_NOT_MATCH');

        Farm farm = Farm(farmFactory.Farms(lpPool));
        if(farm == Farm(address(0))){
            farm = Farm(farmFactory.createFarm(lpPool));
        }

        IERC20Upgradeable(token).safeTransferFrom(msg.sender, address(this), amount);
        IERC20Upgradeable(token).approve(OneInchRouter, amount);

        uint256[] memory amounts = new uint256[](tokens.length);
        {
        sent = amount;
        int256 tokenIndex = -1;
        for (uint256 i = 0; i < tokens.length; i++) {
            if (tokens[i] == lpPool) {
                continue;
            }
            if (tokens[i] == token) {
                tokenIndex = int(i);
                continue;
            }
            bytes memory data = _swap(swapData[i], tokens[i]);
            (uint256 returnAmount, uint256 spentAmount) = abi.decode(data, (uint256, uint256));
            amounts[i] = returnAmount;
            amount -= spentAmount;
        }

        if (tokenIndex != -1) {
            amounts[uint256(tokenIndex)] = amount;
        } else if (amount > 0) {
            sent -= amount;
            IERC20Upgradeable(token).safeTransfer(msg.sender, amount);
        }
        }
        
        liquidity = _addLiquidity(amounts, tokens, minAmountLP, farm.lpPool(), farm.poolId(), farm);//Have to use farm.lpPool() instead of lpPool to avoid stack too deep error
        farm.deposit(liquidity, recipient);

        emit Deposit(lpPool, msg.sender, recipient, liquidity);
    }

    /**
     * @dev Deposits single MATIC in the given pool. Creates new Farm contract if there isn't one deployed for the {lpPool}, swaps MATIC for pool tokens and deposits them. Emits a {Deposit} event.
     * @param lpPool - Address of the pool to deposit tokens in.
     * @param swapData - Parameter with which 1inch router is being called with.
     * @param minAmountLP - Minimum LP the user will receive from {tokens} deposit.
     * @param recipient - Address which will receive the deposit.
     
     * @return sentETH - Total MATIC amount sent to the farm. 
     * @return liquidity - Total liquidity sent to the farm (in lpTokens).
     */
    function depositSingleETH(address lpPool, bytes[] calldata swapData, uint256 minAmountLP, address recipient) external payable whenNotPaused returns(uint256 sentETH, uint256 liquidity){
        require (msg.value > 0, "NO_MATIC_SENT");
        address[] memory tokens = _convertToAddressArray(getTokens(lpPool));
        require (swapData.length == tokens.length, 'INPUT_PARAMS_LENGTHS_NOT_MATCH');

        Farm farm = Farm(farmFactory.Farms(lpPool));
        if(farm == Farm(address(0))){
            farm = Farm(farmFactory.createFarm(lpPool));
        }

        uint256 amount = msg.value;
        IWMATIC(WMATIC).deposit{value: amount}();
        IERC20Upgradeable(WMATIC).approve(OneInchRouter, amount);

        uint256[] memory amounts = new uint256[](tokens.length);
        {
        sentETH = amount;
        int256 wmaticIndex = -1;
        for (uint256 i = 0; i < tokens.length; i++) {
            if (tokens[i] == lpPool) {
                continue;
            }
            if (tokens[i] == WMATIC) {
                wmaticIndex = int(i);
                continue;
            }
            bytes memory data = _swap(swapData[i], tokens[i]);
            (uint256 returnAmount, uint256 spentAmount) = abi.decode(data, (uint256, uint256));
            if (returnAmount > 0) {
                amounts[i] = returnAmount;
            }
            amount -= spentAmount;
        }

        if (wmaticIndex != -1) {
            amounts[uint(wmaticIndex)] = amount;
        } else if (amount > 0){
            sentETH -= amount;
            IWMATIC(WMATIC).withdraw(amount);
            payable(msg.sender).transfer(amount);
        }
        }

        liquidity = _addLiquidity(amounts, tokens, minAmountLP, farm.lpPool(), farm.poolId(), farm);//Have to use farm.lpPool() instead of lpPool to avoid stack too deep error
        farm.deposit(liquidity, recipient);

        emit Deposit(lpPool, msg.sender, recipient, liquidity);
    }

    /**
     * @dev Deposits tokens in the given pool. Creates new Farm contract if there isn't one deployed for the {lpPool} and deposits tokens in it. Emits a {Deposit} event.
     * @param lpPool - Address of the pool to deposit tokens in.
     * @param amount - LP Token amount to deposit.
     * @param recipient - Address which will receive the deposit.
     */
    function depositLP(address lpPool, uint256 amount, address recipient) external whenNotPaused{
        require(amount > 0, "NO_TOKEN_SENT");
        Farm farm = Farm(farmFactory.Farms(lpPool));
        if(farm == Farm(address(0))){
            farm = Farm(farmFactory.createFarm(lpPool));
        }

        IERC20Upgradeable(lpPool).safeTransferFrom(msg.sender, address(farm), amount);
        farm.deposit(amount, recipient);

        emit Deposit(lpPool, msg.sender, recipient, amount); 
    }

    /** 
     * @dev Withdraws tokens from the given pool. 
     * @param lpPool - LP pool to withdraw from.
     * @param userData - Balancer pool exit userData.
     * @param minAmountsOut - Minimum token amounts the user will receive.
     * @param recipient - The address which will receive tokens.

     * @return amounts - Token amounts sent to the {recipient}.
     * @return liquidity - Total liquidity sent to the user (in lpTokens).
     */ 
    function withdraw(address lpPool, bytes calldata userData, uint256[] calldata minAmountsOut, address recipient) external returns(uint256[] memory amounts, uint256 liquidity){ 
        Farm farm = Farm(farmFactory.Farms(lpPool));
        require(farm != Farm(address(0)),'FARM_NOT_EXISTS');

        (amounts, liquidity) = farm.withdrawTokens(userData, minAmountsOut, msg.sender, recipient);
        emit Withdraw(lpPool, msg.sender, recipient, liquidity);
    }

    /** 
     * @dev Autoconverts WMATIC into MATIC and withdraws tokens from the given pool. 
     * @param lpPool - LP pool to withdraw from.
     * @param userData -  Balancer pool exit userData.
     * @param minAmountsOut - Minimum token amounts the user will receive.
     * @param recipient - The address which will receive tokens.

     * @return amounts - Token amounts sent to the {recipient}.
     * @return liquidity - Total liquidity sent to the user (in lpTokens).
     */ 
    function withdrawETH(address lpPool, bytes calldata userData, uint256[] calldata minAmountsOut, address recipient) external returns(uint256[] memory amounts, uint256 liquidity){ 
        Farm farm = Farm(farmFactory.Farms(lpPool));
        require(farm != Farm(address(0)),'FARM_NOT_EXISTS');

        (amounts, liquidity) = farm.withdrawTokens(userData, minAmountsOut, msg.sender, address(this));

        IERC20[] memory tokens = getTokens(lpPool);
        for (uint256 i = 0; i < tokens.length; i++) {
            if (amounts[i] == 0){
                continue;
            }
            if (address(tokens[i]) != WMATIC) {
                IERC20Upgradeable(address(tokens[i])).safeTransfer(recipient, amounts[i]);
                continue;
            }
            IWMATIC(WMATIC).withdraw(amounts[i]);
            payable(recipient).transfer(amounts[i]);
        }

        emit Withdraw(lpPool, msg.sender, recipient, liquidity);  
    }

    /**
     * @dev Withdraws single token from the given pool. Emits a {Withdraw} event. Note: If there are any tokens left to be withdrawn after swaps they will be sent to the {{recipient}} in a respective token (not in {token}).
     * @param lpPool - LP pool to withdraw from.
     * @param token  - Address of a token to exit the pool with.
     * @param userData - Balancer pool exit userData.
     * @param swapData - Parameters with which 1inch router is being called with.
     * @param recipient - Address which will receive the deposit.
     
     * @return amount - {token} amount sent to the {recipient}.
     * @return liquidity - Total liquidity sent to the user (in lpTokens).
     */
    function withdrawSingleAsset(address lpPool, address token, bytes calldata userData, bytes[] calldata swapData, address recipient) external whenNotPaused returns(uint256 amount, uint256 liquidity){
        Farm farm = Farm(farmFactory.Farms(lpPool));
        require(farm != Farm(address(0)),'FARM_NOT_EXISTS');

        address[] memory tokens = _convertToAddressArray(getTokens(lpPool));
        uint256[] memory amounts = new uint256[](tokens.length);
        (amounts, liquidity) = farm.withdrawTokens(userData, amounts, msg.sender, address(this));

        for (uint256 i = 0; i < tokens.length; i++) {
            if (tokens[i] == token) {
                amount += amounts[i];
                continue;
            }
            IERC20(tokens[i]).approve(OneInchRouter, amounts[i]);
            bytes memory data = _swap(swapData[i], token);
            (uint256 returnAmount, uint256 spentAmount) = abi.decode(data, (uint256, uint256));
            amount += returnAmount;
            // Dust
            amounts[i] -= spentAmount;
        }
        
        IERC20Upgradeable(token).safeTransfer(recipient, amount);

        // Not important to have minAmountLP here because we add back dust to the pool which should be very small if correct {swapData} is provided
        uint256 liquidityReturned = _addLiquidity(amounts, tokens, 0, farm.lpPool(), farm.poolId(), farm);
        farm.deposit(liquidityReturned, msg.sender);
        liquidity -= liquidityReturned;

        emit Withdraw(lpPool, msg.sender, recipient, liquidity);
    }
     
    /**
     * @dev Withdraws single MATIC from the given pool. Emits a {Withdraw} event. Note: If there are any tokens left to be withdrawn after swaps they will be sent to the {{recipient}} in a respective token (not in MATIC).
     * @param lpPool - LP pool to withdraw from.
     * @param userData - Balancer pool exit userData.
     * @param swapData - Parameters with which 1inch router is being called with.
     * @param recipient - Address which will receive the deposit.
     
     * @return amountETH - MATIC amount sent to the {recipient}.
     * @return liquidity - Total liquidity sent to the user (in lpTokens).
     */
    function withdrawSingleETH(address lpPool, bytes calldata userData, bytes[] calldata swapData, address recipient) external whenNotPaused returns(uint256 amountETH, uint256 liquidity){
        Farm farm = Farm(farmFactory.Farms(lpPool));
        require(farm != Farm(address(0)),'FARM_NOT_EXISTS');

        address[] memory tokens = _convertToAddressArray(getTokens(lpPool));
        uint256[] memory amounts = new uint256[](tokens.length);
        (amounts, liquidity) = farm.withdrawTokens(userData, amounts, msg.sender, address(this));

        for (uint256 i = 0; i < tokens.length; i++) {
            if (tokens[i] == WMATIC) {
                amountETH += amounts[i];
                continue;
            }
            IERC20(tokens[i]).approve(OneInchRouter, amounts[i]);
            bytes memory data = _swap(swapData[i], WMATIC);
            (uint256 returnAmount, uint256 spentAmount) = abi.decode(data, (uint256, uint256));
            amountETH += returnAmount;
            // Dust
            amounts[i] -= spentAmount;
        }

        IWMATIC(WMATIC).withdraw(amountETH);
        payable(recipient).transfer(amountETH);
        
        // Not important to have minAmountLP here because we add back dust to the pool which should be very small if correct {swapData} is provided
        uint256 liquidityReturned = _addLiquidity(amounts, tokens, 0, farm.lpPool(), farm.poolId(), farm);
        farm.deposit(liquidityReturned, msg.sender);
        liquidity -= liquidityReturned;

        emit Withdraw(lpPool, msg.sender, recipient, liquidity);
    }

    /** 
     * @dev Withdraws LP tokens from the given pool. Emits a {Withdraw} event.
     * @param lpPool - LP pool to withdraw from.
     * @param amount - LP amount to withdraw. 
     * @param recipient - The address which will receive tokens.
     */ 
    function withdrawLP(address lpPool, uint256 amount, address recipient) external {
        Farm farm = Farm(farmFactory.Farms(lpPool));
        require(farm != Farm(address(0)),'FARM_NOT_EXISTS');
        
        farm.withdraw(amount, msg.sender, recipient);
        emit Withdraw(lpPool, msg.sender, recipient, amount);  
    }

    /**
     * @dev Distributes tokens between users for a single {Farms[lpPool]}.
     * @param lpPool - The pool to distribute. 
     * @param swapInfos - The data used to swap reward tokens for the needed tokens.
     * @param feeSwapInfos - The data used to swap reward tokens for fees.
     * @param feeTo - Address to collect fees to.
     *
     * Note: This function can only be called by the distributor.
     */
    function distribute(
        address lpPool,
        Farm.SwapInfo[] calldata swapInfos,
        Farm.SwapInfo[] calldata feeSwapInfos,
        address feeTo
    ) external whenNotPaused onlyRole(DISTRIBUTOR_ROLE) {
        Farm farm = Farm(farmFactory.Farms(lpPool));
        require(farm != Farm(address(0)), 'FARM_NOT_EXISTS');

        uint256 reward = farm.distribute(swapInfos, feeSwapInfos, Farm.FeeInfo(feeTo, fee));
        emit Distribute(lpPool, reward);
    }

    /**
     * @dev Returns LP tokens staked by the {_address} for the given {lpPool}.
     * @param _address - The address to check stakes for.
     * @param lpPool - LP pool to check stakes in.

     * @return Total user stake(in LP tokens).
     */
   function userStake(address _address, address lpPool) external view returns(uint256){
        Farm farm = Farm(farmFactory.Farms(lpPool));
        if (farm != Farm(address(0))) {
            return farm.userBalance(_address);
        }
        return 0;
    }

    /**
     * @dev Returns total amount locked in the pool. Doesn't take pending rewards into account.
     * @param lpPool - LP pool to check total deposits in.

     * @return Total deposits (in LP tokens).
     */
    function totalDeposits(address lpPool) external view returns (uint256) {
        Farm farm = Farm(farmFactory.Farms(lpPool));
        if (farm != Farm(address(0))) {
            return farm.getTotalDeposits();
        }
        return 0;
    }

    /**
     * @dev Returns addresses of tokens in {lpPool}.
     * @param lpPool - LP pool to check tokens in.

     * @return tokens - Token addresses.
     */  
    function getTokens(address lpPool) public view returns(IERC20[] memory tokens){
        bytes32 poolId = IBasePool(lpPool).getPoolId();
        (tokens, , ) = Vault.getPoolTokens(poolId);
    }

    /**
     * @dev Deposits assets to router
     */ 
    function _addLiquidity(
        uint256[] memory amounts, 
        address[] memory tokens,
        uint256 minAmountLP,
        address lpPool,
        bytes32 poolId,
        Farm farm
    ) internal returns(uint256 liquidity){
        bool joinPool;
        for (uint256 i = 0; i < amounts.length; i++) {
            if(amounts[i] > 0){
                if(!joinPool){
                    joinPool = true;
                }
                IERC20Upgradeable(tokens[i]).approve(address(Vault), amounts[i]);
            }
        }
        require (joinPool, 'NO_LIQUIDITY_PROVIDED');

        bytes memory userData;
        if(farm.isComposable()){
            //If pool has pre-minted BPT then don't include those in userData.
            uint256[] memory _amounts = new uint256[](amounts.length - 1);
            uint256 _i = 0;
            for (uint256 i = 0; i < tokens.length; i++) {
                if(tokens[i] != lpPool){
                    _amounts[_i] = amounts[i];
                    _i += 1;
                }
            }
            userData = abi.encode(1, _amounts, minAmountLP);
        } else {
            userData = abi.encode(1, amounts, minAmountLP);
        }

        uint256 amountBefore = IERC20(lpPool).balanceOf(address(farm));
        IVault.JoinPoolRequest memory joinPoolRequest = IVault.JoinPoolRequest(tokens, amounts, userData, false);
        Vault.joinPool(poolId, address(this), address(farm), joinPoolRequest);

        liquidity = IERC20(lpPool).balanceOf(address(farm)) - amountBefore;
    }

    /**
     * @dev Compares passed calldata tokens with real pool tokens
     */ 
    function _checkTokens(
        address[] calldata tokens,
        bytes32 poolId
    ) internal view {
        (IERC20[] memory _tokens,,) = Vault.getPoolTokens(poolId);
        require (tokens.length == _tokens.length, 'BAD_TOKENS_LENGTH');
        for (uint256 i = 0; i < tokens.length; i++) {
            require (tokens[i] == address(_tokens[i]), 'TOKENS_NOT_MATCH_POOL_TOKENS');
        }
    }

    /**
     * @dev Swaps assets using 1inch exchange.
     */  
    function _swap(bytes calldata swapData, address toToken) internal returns(bytes memory data){
        uint256 balanceBefore = IERC20Upgradeable(toToken).balanceOf(address(this));
        bool success;
        (success, data) = OneInchRouter.call(swapData);
        require(success, "SWAP_NOT_SUCCESSFUL");

        //not return returnAmount with spentAmount to avoid stack too deep errors
        (uint256 returnAmount,) = abi.decode(data, (uint256, uint256));
        //checks if all {{toToken}}s from swap were transfered to this address
        uint256 balanceAfter = IERC20Upgradeable(toToken).balanceOf(address(this));
        require(balanceAfter - balanceBefore == returnAmount, "BAD_RETURN_AMOUNT");
    }

    function _convertToAddressArray(IERC20[] memory tokenArray) internal pure returns (address[] memory addresses) {
        addresses = new address[](tokenArray.length);
        for (uint256 i = 0; i < tokenArray.length; i++) {
            addresses[i] = address(tokenArray[i]);
        }
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
