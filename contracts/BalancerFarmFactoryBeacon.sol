// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;
pragma experimental ABIEncoderV2;

import {BalancerFarmUpgradeable as Farm, SafeMath, IERC20, IUniswapV2Pair, Initializable, MerkleOrchard, IVault, IAsset} from "./farms/BalancerFarmUpgradeable.sol"; 
 
import "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol"; 
import "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";

contract BalancerFarmFactoryBeacon is Initializable{
    using SafeMath for uint256; 

    address public farmBeacon;
    address private distributor;

    /**
     * @dev Contract Variables:
     * {Farms} - links {lpPairs} to the deployed Farm contract.
     * {lpPairs} - list of pools that have corresponding deployed Farm contract.
     */
    mapping(address => Farm) public Farms;
    address[] public lpPairs;

    event FarmDeployed(address farmAddress);
    event Deposit(address sender, address lpPair, uint256 amount);
    event Withdraw(address sender, address lpPair, uint256 amount);
    event Distribute(address lpPair);

    modifier distributorOnly(){
        require(msg.sender == distributor);
        _;
    }

    // ============ Methods ============

    function initialize(address upgrader, address _distributor) public initializer {
        UpgradeableBeacon _farmBeacon = new UpgradeableBeacon(
            address(new Farm())
        );
        _farmBeacon.transferOwnership(upgrader);
        farmBeacon = address(_farmBeacon);
        distributor = _distributor;
    }

    /**
     * @dev Creates a new contract if there isn't one and deposits tokens to the lpStakingPool.
     * {amounts} - The amounts of the tokens to deposit.
     * {tokens} - The tokens to deposit.
     * {LPAmount} - The amounts of the LP tokens to deposit.
     * {lpPair} - The address of the pool to deposit tokens in.
     */
    function deposit(uint256[] memory amounts, IERC20[] memory tokens, uint256 LPAmount, address lpPair) external {
        if(Farms[lpPair] == Farm(address(0))){
            Farms[lpPair] = Farm(createFarm(lpPair));
            lpPairs.push(lpPair);
        }

        require (amounts.length == tokens.length, "Amounts and tokens must have the same length");
        for (uint256 i = 0; i < tokens.length; i++) {
            if(amounts[i] > 0){
                tokens[i].transferFrom(msg.sender, address(Farms[lpPair]), amounts[i]);
            }
        }
        if(LPAmount > 0){
            IERC20(lpPair).transferFrom(msg.sender, address(Farms[lpPair]), LPAmount);
        }

        uint256 depositedAmount = Farms[lpPair].deposit(amounts, tokens, LPAmount, msg.sender);
        emit Deposit(msg.sender, lpPair, depositedAmount);
    }

    /**
     * @dev Withdraws tokens from the given pool. 
     * {lpPair} - The pool to withdraw from.
     * {LP} - True: Withdraw in LP tokens, False: Withdraw in normal tokens.
     */ 
    function withdraw(address lpPair, bool withdrawLP) external { 
        require(Farms[lpPair] != Farm(address(0)), 'The given pool doesnt exist');
        uint256 withdrawAmount = Farms[lpPair].withdraw(msg.sender, withdrawLP);
        emit Withdraw(msg.sender, lpPair, withdrawAmount);
    }

     /**
     * @dev Distributes tokens between users for a single { Farms[lpPair] }.
     * {lpPair} - The pool to distribute. (Calculated off-chain)
     * {claims} - Balancer token claims. (Calculated off-chain)
     * {rewardTokens} - Reward tokens to recieve from the pool (Calculated off-chain)
     * {swaps,assets,funds,limits} - The data used to swap reward tokens for the needed tokens (Calculated off-chain)
     * ADMIN ONLY
     */
    function distribute(
        address lpPair,
        MerkleOrchard.Claim[] memory claims,
        IERC20[] memory rewardTokens,
        IVault.BatchSwapStep[][] memory swaps,
        IAsset[][] memory assets,
        IVault.FundManagement[] memory funds,
        int256[][] memory limits
    ) external distributorOnly {
        require(Farms[lpPair] != Farm(address(0)), 'The pool doesnt exist');
        require(swaps.length == assets.length, "Swaps' length doesn't match assets'");
        require(swaps.length == funds.length,  "Swaps' length doesn't match funds'");
        require(swaps.length == limits.length, "Swaps' length doesn't match limits'");

        Farms[lpPair].distribute(claims, rewardTokens, swaps, assets, funds, limits);
        emit Distribute(lpPair);
    }

    /**
     * @dev Returns token values staked by the user
     */ 
    function userStake(address _address, address lpPair) external view returns(uint256){
        if(Farms[lpPair] != Farm(address(0))){
            return Farms[lpPair].userBalance(_address);
        }
        return 0;
    }    
    
    /**
     * @dev Returns total amount locked in the pool. Doesn't take pending rewards into account.
     */ 
    function totalDeposits(address lpPair) external view returns (uint256) {
        if (Farms[lpPair] != Farm(address(0))){
            return Farms[lpPair].getTotalDeposits();
        }
        return 0;
    }

    /**
     * @dev poolLength().
     */
    function poolLength() external view returns (uint256){
        return lpPairs.length;
    }

    function transferDistributor(address newDistributor) external distributorOnly {
        distributor = newDistributor;
    }

    function createFarm(address lpPair) internal returns (address) {
        BeaconProxy proxy = new BeaconProxy(
            farmBeacon,
            abi.encodeWithSelector(
                Farm(address(0)).initialize.selector,
                lpPair,
                address(this)
            )
        );
        emit FarmDeployed(address(proxy));
        return address(proxy);
    }

}
