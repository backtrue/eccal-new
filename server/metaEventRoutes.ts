import express from 'express';
import { requireJWTAuth } from './jwtAuth';

const router = express.Router();

// Temporary storage for purchase events (in production, use Redis or database)
const pendingPurchaseEvents = new Map<string, any>();

// Store purchase event for frontend tracking
export function storePurchaseEventForUser(userId: string, eventData: any) {
  const eventId = crypto.randomUUID();
  const event = {
    ...eventData,
    eventId,
    createdAt: new Date(),
    consumed: false
  };
  
  pendingPurchaseEvents.set(userId, event);
  
  // Auto-cleanup after 5 minutes
  setTimeout(() => {
    pendingPurchaseEvents.delete(userId);
  }, 5 * 60 * 1000);
  
  return eventId;
}

// Frontend polling endpoint to get pending purchase events
router.get('/purchase-events', requireJWTAuth, async (req: any, res) => {
  try {
    const userId = req.user.id;
    const event = pendingPurchaseEvents.get(userId);
    
    if (event && !event.consumed) {
      // Mark as consumed
      event.consumed = true;
      
      // Remove from storage after 30 seconds
      setTimeout(() => {
        pendingPurchaseEvents.delete(userId);
      }, 30 * 1000);
      
      res.json({
        success: true,
        event: {
          paymentType: event.paymentType,
          amount: event.amount,
          currency: event.currency,
          transactionId: event.transactionId,
          timestamp: event.timestamp
        }
      });
    } else {
      res.json({
        success: true,
        event: null
      });
    }
  } catch (error) {
    console.error('Error getting purchase events:', error);
    res.status(500).json({ success: false, error: '獲取購買事件失敗' });
  }
});

// Manual trigger endpoint for testing
router.post('/trigger-purchase-event', requireJWTAuth, async (req: any, res) => {
  try {
    const { paymentType, amount, currency } = req.body;
    const userId = req.user.id;
    
    const eventData = {
      userId,
      paymentType,
      amount,
      currency,
      transactionId: `test_${Date.now()}`,
      timestamp: new Date().toISOString(),
      eventType: 'purchase'
    };
    
    const eventId = storePurchaseEventForUser(userId, eventData);
    
    res.json({
      success: true,
      message: '測試購買事件已觸發',
      eventId
    });
  } catch (error) {
    console.error('Error triggering test purchase event:', error);
    res.status(500).json({ success: false, error: '觸發測試事件失敗' });
  }
});

export { pendingPurchaseEvents };
export default router;