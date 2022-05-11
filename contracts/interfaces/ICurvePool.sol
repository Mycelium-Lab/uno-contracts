interface CurvePool {
    function add_liquidity(uint256 uamounts, uint256 min_mint_amount) external;
    function remove_liquidity(uint256 _amount, uint256 min_uamounts) external;
}
