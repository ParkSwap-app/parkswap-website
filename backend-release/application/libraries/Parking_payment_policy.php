<?php
defined('BASEPATH') OR exit('No direct script access allowed');

/**
 * One source of truth for ParkSwap thank-you payment economics.
 * Monetary calculations stay in cents to avoid rounding differences.
 */
class Parking_payment_policy {

    const DEFAULT_PLATFORM_COMMISSION_PERCENT = 20.00;

    protected $CI;

    public function __construct() {
        $this->CI =& get_instance();
    }

    public function calculate($amount) {
        $totalCents = (int) round(((float) $amount) * 100);
        if ($totalCents < 1) {
            throw new InvalidArgumentException('Payment amount must be greater than zero.');
        }

        $percent = self::DEFAULT_PLATFORM_COMMISSION_PERCENT;
        $option = $this->CI->common_model->is_data_exists(
            OPTIONS,
            array('option_name' => 'platform_commission_percent')
        );

        if (!empty($option) && is_numeric($option->option_value)) {
            $percent = (float) $option->option_value;
        }
        $percent = max(0, min(100, $percent));

        $commissionCents = (int) round($totalCents * $percent / 100);
        $payoutCents = max(0, $totalCents - $commissionCents);

        return array(
            'amount' => $totalCents / 100,
            'amount_cents' => $totalCents,
            'commission_percent' => $percent,
            'commission_amount' => $commissionCents / 100,
            'commission_amount_cents' => $commissionCents,
            'payout_amount' => $payoutCents / 100,
            'payout_amount_cents' => $payoutCents,
        );
    }
}
