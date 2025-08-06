import { db } from './db';
import { discountUsages, discountCodes } from '@shared/schema';
import { eq, sql } from 'drizzle-orm';

/**
 * Integrate discount system with Stripe payment flow
 */
export class DiscountIntegration {
  
  /**
   * Apply discount to Stripe payment and record usage
   */
  static async applyDiscountToPayment(
    usageTrackingId: string, 
    paymentIntentId: string,
    paymentStatus: 'completed' | 'failed' = 'completed'
  ) {
    try {
      console.log(`Applying discount for payment ${paymentIntentId}, tracking ID: ${usageTrackingId}`);
      
      // Call the cross-platform apply API
      const response = await fetch(`${process.env.BASE_URL || 'http://localhost:5000'}/api/discount-codes/apply-cross-platform`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          usage_tracking_id: usageTrackingId,
          external_transaction_id: paymentIntentId,
          payment_status: paymentStatus
        })
      });

      const result = await response.json();
      
      if (result.success) {
        console.log(`Discount applied successfully: ${result.usage_id}`);
        return result.usage_id;
      } else {
        console.error('Failed to apply discount:', result.message);
        return null;
      }
    } catch (error) {
      console.error('Error applying discount to payment:', error);
      return null;
    }
  }

  /**
   * Validate discount before creating payment intent
   */
  static async validateDiscountForPayment(
    code: string,
    amount: number, // in cents
    currency: string,
    serviceName: string = 'eccal',
    userEmail?: string,
    userId?: string
  ) {
    try {
      // Convert amount to main units for validation
      const amountInMainUnits = currency === 'JPY' ? amount : amount / 100;
      
      const response = await fetch(`${process.env.BASE_URL || 'http://localhost:5000'}/api/discount-codes/validate-cross-platform`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          amount: amountInMainUnits,
          currency,
          service_name: serviceName,
          user_email: userEmail,
          user_id: userId
        })
      });

      const result = await response.json();
      
      if (result.valid) {
        return {
          isValid: true,
          discountAmount: result.calculation.discount_amount,
          finalAmount: result.calculation.final_amount,
          usageTrackingId: result.usage_tracking_id,
          discountCode: result.discount_code
        };
      } else {
        return {
          isValid: false,
          error: result.error,
          message: result.message
        };
      }
    } catch (error) {
      console.error('Error validating discount:', error);
      return {
        isValid: false,
        error: 'VALIDATION_ERROR',
        message: '折扣驗證時發生錯誤'
      };
    }
  }

  /**
   * Get discount statistics for admin dashboard
   */
  static async getDiscountStatistics(dateRange?: { start: Date; end: Date }) {
    try {
      let whereConditions = [eq(discountUsages.paymentStatus, 'completed')];
      
      if (dateRange) {
        whereConditions.push(
          sql`${discountUsages.usedAt} >= ${dateRange.start}`,
          sql`${discountUsages.usedAt} <= ${dateRange.end}`
        );
      }

      const stats = await db
        .select({
          totalUsage: sql<number>`count(*)`,
          totalDiscountGiven: sql<number>`sum(${discountUsages.discountAmount})`,
          totalRevenueAfterDiscount: sql<number>`sum(${discountUsages.finalAmount})`,
          avgDiscountAmount: sql<number>`avg(${discountUsages.discountAmount})`,
          uniqueUsers: sql<number>`count(distinct ${discountUsages.userEmail})`,
          serviceBreakdown: sql<any>`jsonb_object_agg(${discountUsages.serviceName}, count(*))`,
        })
        .from(discountUsages)
        .where(whereConditions.length > 1 ? sql`${whereConditions.join(' AND ')}` : whereConditions[0]);

      return stats[0];
    } catch (error) {
      console.error('Error getting discount statistics:', error);
      return null;
    }
  }

  /**
   * Clean up expired pending applications (should be run periodically)
   */
  static async cleanupExpiredApplications() {
    // This would be implemented if we were storing pending applications in database
    // For now, they're stored in memory with automatic cleanup
    console.log('Cleanup expired applications - handled in memory');
  }

  /**
   * Create sample discount codes for testing
   */
  static async createSampleDiscountCodes(adminEmail: string) {
    try {
      const sampleCodes = [
        {
          code: 'WELCOME20',
          discountType: 'percentage' as const,
          discountValue: '20.00',
          currency: 'ALL',
          applicableServices: ['eccal', 'fabe'],
          description: '新用戶歡迎折扣 20%',
          campaignName: '新用戶歡迎活動',
          isActive: true,
          createdBy: adminEmail
        },
        {
          code: 'SAVE100',
          discountType: 'fixed' as const,
          discountValue: '100.00',
          currency: 'TWD',
          applicableServices: ['eccal'],
          minimumAmount: 50000, // NT$500 minimum
          description: '固定折扣 NT$100 (最低消費 NT$500)',
          campaignName: '固定折扣促銷',
          isActive: true,
          createdBy: adminEmail
        },
        {
          code: 'FABE15',
          discountType: 'percentage' as const,
          discountValue: '15.00',
          currency: 'ALL',
          applicableServices: ['fabe'],
          usageLimit: 100,
          description: 'Fabe 課程專屬 15% 折扣',
          campaignName: 'Fabe 課程促銷',
          isActive: true,
          createdBy: adminEmail
        },
        {
          code: 'FLASH30',
          discountType: 'percentage' as const,
          discountValue: '30.00',
          currency: 'ALL',
          applicableServices: ['eccal', 'fabe'],
          usageLimit: 50,
          perUserLimit: 1,
          validUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
          description: '限時閃購 30% 折扣 (限量 50 組)',
          campaignName: '限時閃購活動',
          isActive: true,
          createdBy: adminEmail
        }
      ];

      const createdCodes = [];
      for (const codeData of sampleCodes) {
        try {
          const [code] = await db
            .insert(discountCodes)
            .values(codeData)
            .returning();
          createdCodes.push(code);
        } catch (error) {
          // Code might already exist, skip
          console.log(`Sample code ${codeData.code} already exists or failed to create`);
        }
      }

      console.log(`Created ${createdCodes.length} sample discount codes`);
      return createdCodes;
    } catch (error) {
      console.error('Error creating sample discount codes:', error);
      return [];
    }
  }
}

export default DiscountIntegration;