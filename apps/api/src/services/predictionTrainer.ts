import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger';
import type { MarketContext, Decision, Trade } from '@matcha-ai/shared';
import { matchaBrain } from './matchaBrain';

const prisma = new PrismaClient();

export interface PredictionResult {
  predictionId: string;
  wasCorrect: boolean;
  outcome: 'correct' | 'incorrect' | 'neutral';
  pnl?: number;
  learning: string;
}

export class PredictionTrainer {
  /**
   * Store a prediction before making a trade decision
   */
  async storePrediction(
    strategyId: string,
    symbol: string,
    decision: Decision,
    context: MarketContext,
    indicators: any
  ): Promise<string> {
    const prediction = await prisma.prediction.create({
      data: {
        strategyId,
        symbol,
        predictedAction: decision.action,
        predictedPrice: context.recentCandles[context.recentCandles.length - 1]?.close,
        confidence: decision.confidence,
        marketContext: JSON.stringify({
          priceTrend: context.recentCandles.length >= 2
            ? (context.recentCandles[context.recentCandles.length - 1].close - context.recentCandles[0].close) / context.recentCandles[0].close
            : 0,
          volatility: context.indicators.volatility || 0,
          performance: context.performance,
          dailyPnl: context.dailyPnl,
        }),
        indicators: JSON.stringify(indicators),
        reasoning: decision.notes || decision.reasoning?.keyFactors?.join(', ') || null,
      },
    });

    logger.info({ predictionId: prediction.id, strategyId, symbol, action: decision.action }, 'Prediction stored');
    return prediction.id;
  }

  /**
   * Evaluate a prediction after trade outcome is known
   */
  async evaluatePrediction(
    predictionId: string,
    trade: Trade | null,
    actualPrice: number,
    actualAction: 'long' | 'short' | 'flat'
  ): Promise<PredictionResult> {
    const prediction = await prisma.prediction.findUnique({
      where: { id: predictionId },
    });

    if (!prediction) {
      throw new Error(`Prediction not found: ${predictionId}`);
    }

    let outcome: 'correct' | 'incorrect' | 'neutral' = 'neutral';
    let wasCorrect = false;
    let learning = '';

    // Evaluate prediction accuracy
    if (prediction.predictedAction === actualAction) {
      outcome = 'correct';
      wasCorrect = true;
      learning = `Correctly predicted ${actualAction}. Market conditions aligned with prediction.`;
    } else if (prediction.predictedAction === 'flat' && actualAction !== 'flat') {
      outcome = 'neutral';
      learning = `Predicted flat but market moved ${actualAction}. Conservative approach.`;
    } else if (prediction.predictedAction !== 'flat' && actualAction === 'flat') {
      outcome = 'neutral';
      learning = `Predicted ${prediction.predictedAction} but stayed flat. Market conditions changed.`;
    } else {
      outcome = 'incorrect';
      wasCorrect = false;
      learning = `Incorrectly predicted ${prediction.predictedAction} but market went ${actualAction}. Review indicators and context.`;
    }

    // Analyze what went wrong/right
    if (trade) {
      const pnl = trade.pnl || 0;
      if (pnl > 0 && wasCorrect) {
        learning += ` Trade was profitable (+$${pnl.toFixed(2)}). This pattern worked well.`;
      } else if (pnl < 0 && !wasCorrect) {
        learning += ` Trade lost money (-$${Math.abs(pnl).toFixed(2)}). Similar conditions should be avoided.`;
      } else if (pnl > 0 && !wasCorrect) {
        learning += ` Despite wrong prediction, trade was profitable (+$${pnl.toFixed(2)}). Market moved favorably.`;
      } else if (pnl < 0 && wasCorrect) {
        learning += ` Correct prediction but trade lost money (-$${Math.abs(pnl).toFixed(2)}). Timing or execution issue.`;
      }
    }

    // Update prediction with outcome
    await prisma.prediction.update({
      where: { id: predictionId },
      data: {
        actualAction,
        actualPrice,
        outcome,
        pnl: trade?.pnl || null,
        tradeId: trade?.id || null,
        evaluatedAt: new Date(),
        learningNotes: learning,
      },
    });

    logger.info({ predictionId, outcome, wasCorrect }, 'Prediction evaluated');

    return {
      predictionId,
      wasCorrect,
      outcome,
      pnl: trade?.pnl,
      learning,
    };
  }

  /**
   * Get learning insights from past predictions
   */
  async getLearningInsights(strategyId: string, limit: number = 100): Promise<{
    accuracy: number;
    correctPatterns: string[];
    incorrectPatterns: string[];
    recommendations: string[];
  }> {
    const predictions = await prisma.prediction.findMany({
      where: {
        strategyId,
        evaluatedAt: { not: null },
        outcome: { not: null },
      },
      orderBy: { timestamp: 'desc' },
      take: limit,
    });

    if (predictions.length === 0) {
      return {
        accuracy: 0,
        correctPatterns: [],
        incorrectPatterns: [],
        recommendations: ['Need more predictions to learn from'],
      };
    }

    const correct = predictions.filter((p) => p.outcome === 'correct');
    const incorrect = predictions.filter((p) => p.outcome === 'incorrect');
    const accuracy = correct.length / predictions.length;

    // Analyze patterns in correct predictions
    const correctPatterns: string[] = [];
    correct.forEach((p) => {
      const indicators = JSON.parse(p.indicators || '{}');
      if (indicators.rsi && indicators.rsi < 40) {
        correctPatterns.push('Low RSI (<40) often leads to correct long predictions');
      }
      if (indicators.rsi && indicators.rsi > 60) {
        correctPatterns.push('High RSI (>60) often leads to correct short predictions');
      }
      if (indicators.ema20 && indicators.ema50 && indicators.ema20 > indicators.ema50) {
        correctPatterns.push('EMA20 > EMA50 trend often leads to correct long predictions');
      }
    });

    // Analyze patterns in incorrect predictions
    const incorrectPatterns: string[] = [];
    incorrect.forEach((p) => {
      const indicators = JSON.parse(p.indicators || '{}');
      if (indicators.volatility && indicators.volatility > 0.05) {
        incorrectPatterns.push('High volatility (>5%) often leads to incorrect predictions');
      }
    });

    // Generate recommendations
    const recommendations: string[] = [];
    if (accuracy < 0.5) {
      recommendations.push('Accuracy is below 50%. Consider being more conservative with predictions.');
    }
    if (incorrectPatterns.length > correctPatterns.length) {
      recommendations.push('More incorrect patterns than correct. Review market conditions before predicting.');
    }
    if (accuracy > 0.6) {
      recommendations.push('Good accuracy! Continue using current prediction patterns.');
    }

    return {
      accuracy,
      correctPatterns: [...new Set(correctPatterns)].slice(0, 5),
      incorrectPatterns: [...new Set(incorrectPatterns)].slice(0, 5),
      recommendations,
    };
  }

  /**
   * Get historical decisions for learning
   */
  async getHistoricalDecisions(
    strategyId: string,
    limit: number = 50
  ): Promise<Array<{ decision: Decision; outcome?: 'win' | 'loss' | 'neutral' }>> {
    const predictions = await prisma.prediction.findMany({
      where: {
        strategyId,
        evaluatedAt: { not: null },
        tradeId: { not: null },
      },
      include: {
        strategy: {
          include: {
            trades: {
              where: { id: { in: [] } }, // Will be filtered by tradeId
            },
          },
        },
      },
      orderBy: { timestamp: 'desc' },
      take: limit,
    });

    return predictions.map((p) => {
      const decision: Decision = {
        action: p.predictedAction as 'long' | 'short' | 'flat',
        confidence: p.confidence,
        targetPositionSizePct: 0, // Not stored, but not needed for learning
        notes: p.reasoning || '',
      };

      let outcome: 'win' | 'loss' | 'neutral' | undefined;
      if (p.outcome === 'correct' && p.pnl && p.pnl > 0) {
        outcome = 'win';
      } else if (p.outcome === 'incorrect' || (p.pnl && p.pnl < 0)) {
        outcome = 'loss';
      } else {
        outcome = 'neutral';
      }

      return { decision, outcome };
    });
  }

  /**
   * Improve decision based on past mistakes
   */
  async improveDecision(
    strategyId: string,
    decision: Decision,
    context: MarketContext
  ): Promise<Decision> {
    const insights = await this.getLearningInsights(strategyId, 50);
    const historicalDecisions = await this.getHistoricalDecisions(strategyId, 30);

    // Adjust confidence based on accuracy
    let adjustedConfidence = decision.confidence;
    if (insights.accuracy < 0.4) {
      // Low accuracy - be more conservative
      adjustedConfidence = Math.max(0.3, decision.confidence * 0.8);
    } else if (insights.accuracy > 0.6) {
      // High accuracy - can be more confident
      adjustedConfidence = Math.min(0.9, decision.confidence * 1.1);
    }

    // Check for similar past mistakes
    const similarMistakes = historicalDecisions.filter((h) => {
      if (h.outcome === 'loss' && h.decision.action === decision.action) {
        // Similar action that led to loss
        return true;
      }
      return false;
    });

    if (similarMistakes.length > 3) {
      // Too many similar mistakes - reduce confidence or change action
      adjustedConfidence = Math.max(0.2, adjustedConfidence * 0.7);
      if (adjustedConfidence < 0.4) {
        // Confidence too low - stay flat
        return {
          action: 'flat',
          confidence: 0.2,
          targetPositionSizePct: 0,
          notes: 'Similar past mistakes detected. Staying flat for safety.',
        };
      }
    }

    // Check for similar successful patterns
    const similarWins = historicalDecisions.filter((h) => {
      if (h.outcome === 'win' && h.decision.action === decision.action) {
        return true;
      }
      return false;
    });

    if (similarWins.length > 3) {
      // Similar successful pattern - boost confidence
      adjustedConfidence = Math.min(0.9, adjustedConfidence * 1.15);
    }

    return {
      ...decision,
      confidence: adjustedConfidence,
      targetPositionSizePct: adjustedConfidence * (context.riskLimits?.maxPositionPct || 10),
      notes: `${decision.notes || ''} [Learned: ${insights.accuracy > 0.5 ? 'High accuracy' : 'Improving'}]`,
    };
  }
}

export const predictionTrainer = new PredictionTrainer();


