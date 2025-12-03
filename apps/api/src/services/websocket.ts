import { WebSocketServer, WebSocket } from 'ws';
import { logger } from '../config/logger';

interface Client {
  ws: WebSocket;
  strategyIds: Set<string>;
  subscribedSymbols: Set<string>;
}

export class WebSocketService {
  private wss: WebSocketServer | null = null;
  private clients: Set<Client> = new Set();

  start(port: number) {
    try {
      this.wss = new WebSocketServer({ port });
    } catch (error: any) {
      logger.error({ error: error.message, port }, 'Failed to start WebSocket server');
      throw error;
    }

    this.wss.on('connection', (ws: WebSocket) => {
      const client: Client = {
        ws,
        strategyIds: new Set(),
        subscribedSymbols: new Set(),
      };
      this.clients.add(client);

      logger.info({ clientCount: this.clients.size }, 'WebSocket client connected');

      ws.on('message', (message: string) => {
        try {
          const data = JSON.parse(message);
          this.handleMessage(client, data);
        } catch (error) {
          logger.error({ error }, 'Error parsing WebSocket message');
        }
      });

      ws.on('close', () => {
        this.clients.delete(client);
        logger.info({ clientCount: this.clients.size }, 'WebSocket client disconnected');
      });

      ws.on('error', (error) => {
        logger.error({ error: error.message || error }, 'WebSocket client error');
        // Don't remove client on error - let close handler do it
      });

      // Send welcome message
      this.sendToClient(client, {
        type: 'connected',
        data: { message: 'Connected to Matcha AI WebSocket' },
        timestamp: Date.now(),
      });
    });

    this.wss.on('error', (error) => {
      logger.error({ error: error.message || error }, 'WebSocket server error');
    });

    this.wss.on('listening', () => {
      logger.info({ port }, 'WebSocket server started and listening');
    });
  }

  private handleMessage(client: Client, data: any) {
    switch (data.type) {
      case 'subscribe':
        if (data.strategyId) {
          client.strategyIds.add(data.strategyId);
        }
        if (data.symbol) {
          client.subscribedSymbols.add(data.symbol);
        }
        this.sendToClient(client, {
          type: 'subscribed',
          data: { strategyIds: Array.from(client.strategyIds), symbols: Array.from(client.subscribedSymbols) },
          timestamp: Date.now(),
        });
        break;
      case 'unsubscribe':
        if (data.strategyId) {
          client.strategyIds.delete(data.strategyId);
        }
        if (data.symbol) {
          client.subscribedSymbols.delete(data.symbol);
        }
        break;
      default:
        logger.warn({ type: data.type }, 'Unknown WebSocket message type');
    }
  }

  private sendToClient(client: Client, message: any) {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(message));
    }
  }

  /**
   * Standardized event envelope for all WebSocket messages
   */
  private createEvent(type: string, strategyId: string | undefined, payload: any) {
    return {
      type,
      strategyId,
      payload,
      timestamp: Date.now(),
    };
  }

  broadcastPrice(symbol: string, price: number, timestamp: number) {
    const message = this.createEvent('price', undefined, { symbol, price, timestamp });

    this.clients.forEach((client) => {
      if (client.subscribedSymbols.has(symbol)) {
        this.sendToClient(client, message);
      }
    });
  }

  broadcastTrade(strategyId: string, trade: any) {
    const message = this.createEvent('trade', strategyId, { trade });

    this.clients.forEach((client) => {
      if (client.strategyIds.has(strategyId)) {
        this.sendToClient(client, message);
      }
    });
  }

  broadcastPerformance(strategyId: string, performance: any) {
    const message = this.createEvent('performance', strategyId, { performance });

    this.clients.forEach((client) => {
      if (client.strategyIds.has(strategyId)) {
        this.sendToClient(client, message);
      }
    });
  }

  broadcastStatus(strategyId: string, status: string) {
    const message = this.createEvent('status', strategyId, { status });

    this.clients.forEach((client) => {
      if (client.strategyIds.has(strategyId)) {
        this.sendToClient(client, message);
      }
    });
  }

  stop() {
    this.clients.forEach((client) => {
      client.ws.close();
    });
    this.clients.clear();
    if (this.wss) {
      this.wss.close();
    }
    logger.info('WebSocket server stopped');
  }
}

export const wsService = new WebSocketService();

