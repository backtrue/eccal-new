import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { trackPurchaseEvent } from '@/lib/meta-pixel';

// Hook to automatically track purchase events when they occur
export function useMetaTracking() {
  const queryClient = useQueryClient();
  const lastProcessedEvent = useRef<string | null>(null);

  // Poll for purchase events
  const { data: eventData } = useQuery({
    queryKey: ['/api/meta-events/purchase-events'],
    refetchInterval: 5000, // Poll every 5 seconds
    retry: false,
    staleTime: 0 // Always consider stale to ensure fresh data
  });

  useEffect(() => {
    if (eventData?.success && eventData.event) {
      const event = eventData.event;
      
      // Prevent duplicate processing
      if (lastProcessedEvent.current === event.transactionId) {
        return;
      }
      
      console.log('Processing Meta Purchase event:', event);
      
      // Track the purchase event
      trackPurchaseEvent({
        paymentType: event.paymentType,
        amount: event.amount,
        currency: event.currency,
        transactionId: event.transactionId,
      });
      
      // Mark as processed
      lastProcessedEvent.current = event.transactionId;
      
      // Invalidate related queries to refresh user data
      queryClient.invalidateQueries({ queryKey: ['/api/user'] });
      queryClient.invalidateQueries({ queryKey: ['/api/user/membership'] });
      
      console.log(`Meta Purchase event tracked for transaction: ${event.transactionId}`);
    }
  }, [eventData, queryClient]);

  return {
    isTracking: !!eventData?.event,
    lastEvent: eventData?.event || null
  };
}

// Manual trigger for testing purchase events
export function useTestPurchaseEvent() {
  const triggerTestEvent = async (paymentType: string, amount: number, currency: string = 'TWD') => {
    try {
      const response = await fetch('/api/meta-events/trigger-purchase-event', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          paymentType,
          amount,
          currency
        })
      });
      
      const result = await response.json();
      
      if (result.success) {
        console.log('Test purchase event triggered:', result.eventId);
        return result;
      } else {
        throw new Error(result.error || 'Failed to trigger test event');
      }
    } catch (error) {
      console.error('Error triggering test purchase event:', error);
      throw error;
    }
  };

  return { triggerTestEvent };
}