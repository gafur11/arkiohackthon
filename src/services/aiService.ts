import { supabase } from '@/integrations/supabase/client';
import { predictiveService } from './predictiveService';
import { businessInsightsService } from './businessInsightsService';

const OPENROUTER_API_KEY = "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";
const MODEL = "kwaipilot/kat-coder-pro:free";

// Helper functions
type OrderData = {
  order_status?: string;
  product_name?: string;
  carrier_name?: string;
  actual_delivery?: string;
  expected_delivery?: string;
  [key: string]: any;
};

function getStatusExplanation(status?: string): string {
  if (!status) return 'Your order is being processed.';
  
  const statusMap: Record<string, string> = {
    'processing': 'Your order is being prepared for shipment.',
    'shipped': 'Your order is on its way to you!',
    'delivered': 'Your order has been delivered.',
    'delayed': 'Your delivery is taking longer than expected.',
    'out_for_delivery': 'Your package is with the delivery driver and should arrive soon!',
    'exception': 'There is an issue with your delivery that needs attention.'
  };
  
  return statusMap[status.toLowerCase()] || 'Your order is being processed.';
}

function getNextExpectedAction(status?: string): string {
  if (!status) return 'Please check back soon for updates.';
  
  const actionMap: Record<string, string> = {
    'processing': 'You will receive a shipping confirmation email soon.',
    'shipped': 'Please track your package using the information above.',
    'delivered': 'Please check your delivery location and with household members.',
    'delayed': 'We are monitoring the situation and will update you soon.',
    'out_for_delivery': 'Please ensure someone is available to receive the package.',
    'exception': 'Our team is working to resolve this issue.'
  };
  
  return actionMap[status.toLowerCase()] || 'Thank you for your patience.';
}

function getQuickSummary(orderData?: OrderData): string {
  if (!orderData) return 'Processing your request...';
  
  const status = orderData.order_status?.toLowerCase() || '';
  const product = orderData.product_name || 'your items';
  
  switch(status) {
    case 'processing':
      return `We're preparing ${product} for shipment.`;
    case 'shipped':
      return `${product} is on the way with ${orderData.carrier_name || 'the carrier'}.`;
    case 'delivered':
      return `${product} was delivered on ${formatDate(orderData.actual_delivery)}.`;
    case 'delayed':
      return `Your delivery is delayed. New estimated delivery: ${formatDate(orderData.expected_delivery)}.`;
    default:
      return `Status: ${orderData.order_status || 'processing'}.`;
  }
}

interface Order {
  id: string;
  order_id: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  customer_address: string;
  customer_city: string;
  customer_state: string;
  customer_pincode: string;
  customer_country: string;
  product_id: string;
  product_name: string;
  product_category: string;
  product_subcategory: string;
  product_brand: string;
  product_color: string | null;
  product_size: string | null;
  product_price: number;
  quantity: number;
  discount_percent: number;
  discount_amount: number;
  tax_amount: number;
  shipping_fee: number;
  total_amount: number;
  order_status: string;
  payment_method: string;
  payment_status: string;
  payment_id: string | null;
  order_date: string;
  confirmed_date: string | null;
  packed_date: string | null;
  shipped_date: string | null;
  expected_delivery: string | null;
  actual_delivery: string | null;
  tracking_number: string | null;
  carrier_name: string | null;
  current_location: string | null;
  seller_name: string;
  seller_rating: number | null;
  order_notes: string | null;
  is_gift: boolean;
  gift_message: string | null;
  created_at: string;
  updated_at: string;
}

function formatDate(dateString: string | null): string {
  if (!dateString) return 'TBD';
  
  try {
    return new Date(dateString).toLocaleDateString('en-IN', { 
      day: 'numeric', 
      month: 'short', 
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch (e) {
    return dateString;
  }
}

function formatOrderForDisplay(order: Order): string {
  return `
    Order ID: ${order.order_id || 'N/A'}
    Status: ${order.order_status || 'N/A'}
    Order Date: ${order.order_date ? formatDate(order.order_date) : 'N/A'}
    Customer: ${order.customer_name || 'N/A'}
    Items: ${order.quantity || 0} item${order.quantity !== 1 ? 's' : ''}
    Total Amount: ₹${order.total_amount || 'N/A'}
    Tracking #: ${order.tracking_number || 'Not available'}
    Carrier: ${order.carrier_name || 'Not specified'}
    Current Location: ${order.current_location || 'In transit'}
    Expected Delivery: ${order.expected_delivery ? formatDate(order.expected_delivery) : 'Not available'}
  `;
}

async function getRelevantOrderData(userMessage: string): Promise<string> {
  const lowerMessage = userMessage.toLowerCase();
  let results: string[] = [];
  
  // Check for specific order ID
  const orderIdMatch = lowerMessage.match(/od\d+/i);
  if (orderIdMatch) {
    const { data } = await supabase
      .from('orders')
      .select('*')
      .ilike('order_id', `%${orderIdMatch[0]}%`)
      .limit(1);
      
    if (data && data.length > 0) {
      results.push(`Found order:\n${formatOrderForDisplay(data[0])}`);
    }
  }
  
  // Add more search logic here...
  
  return results.join('\n\n---\n\n') || 'No matching orders found.';
}

export async function getAIResponse(userMessage: string, conversationHistory: any[] = []): Promise<string> {
  try {
    // Get relevant order data
    const relevantData = await getRelevantOrderData(userMessage);
    
    // Get predictive insights for relevant orders
    let predictiveInsights = "";
    if (relevantData && relevantData.trim()) {
      try {
        // Extract order IDs from the relevant data
        const orderIds: string[] = [];
        const orderIdMatches = relevantData.match(/Order ID: ([^\s]+)/g);
        if (orderIdMatches) {
          orderIdMatches.forEach(match => {
            const orderId = match.replace('Order ID: ', '');
            orderIds.push(orderId);
          });
        }
        
        if (orderIds.length > 0) {
          const predictions = await predictiveService.predictDeliveryDelays(orderIds);
          
          if (predictions.length > 0) {
            const highRiskOrders = predictions.filter((p: any) => p.delayProbability > 50);
            if (highRiskOrders.length > 0) {
              predictiveInsights = highRiskOrders.map(p => 
                `Order ${p.orderId}: ${p.delayProbability.toFixed(0)}% delay risk`
              ).join('\n');
            }
          }
        }
      } catch (predError) {
        console.error('Predictive service error:', predError);
      }
    }

    // Get business insights for business-related queries
    let businessInsights = "";
    if (userMessage.toLowerCase().includes('business') || 
        userMessage.toLowerCase().includes('revenue') || 
        userMessage.toLowerCase().includes('sales')) {
      try {
        const insights = await businessInsightsService.getBusinessInsights();
        businessInsights = `Business Insights:\nTotal Revenue: ₹${insights.revenue?.totalRevenue || 0}\n`;
      } catch (businessError) {
        console.error('Business insights service error:', businessError);
      }
    }

    // Parse order data if available
    let orderData: Partial<Order> = {};
    try {
      if (relevantData) {
        // In a real implementation, you would parse the relevant data
        // orderData = JSON.parse(relevantData);
      }
    } catch (e) {
      console.error('Error parsing order data:', e);
    }

    const systemPrompt = `You are ARKIO, an advanced AI assistant for order tracking and customer support. 
    Be professional, empathetic, and detail-oriented in your responses.`;

    // Build the user message with structured data
    const userMessageContent = `
    Order Information:
    ${relevantData || 'No order data available'}
    
    ${predictiveInsights ? `\nPredictive Insights:\n${predictiveInsights}\n` : ''}
    ${businessInsights ? `\n${businessInsights}\n` : ''}
    
    Please provide a helpful response to the user's query about their order.`;

    // Prepare the messages array for the API call
    const messages: Array<{ role: string; content: string }> = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessageContent }
    ];

    // Add conversation history if available
    if (conversationHistory && conversationHistory.length > 0) {
      messages.unshift(...conversationHistory.slice(-5));
    }

    // Make the API call to OpenRouter
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: MODEL,
          messages: messages,
          max_tokens: 1000,
          temperature: 0.7,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('OpenRouter API error:', errorData);
        throw new Error(`API request failed with status ${response.status}`);
      }

      const data = await response.json();
      return data.choices[0]?.message?.content || 'I apologize, but I encountered an issue processing your request.';
    } catch (error) {
      console.error('Error calling OpenRouter API:', error);
      return 'I apologize, but I encountered an error while processing your request. Please try again later.';
    }
  } catch (error) {
    console.error('Error in getAIResponse:', error);
    return 'I apologize, but I encountered an error while processing your request. Please try again later.';
  }
}
