import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger';
import OpenAI from 'openai';
import { config } from '../config/env';
import type { Decision, MarketContext, StrategyConfig } from '@matcha-ai/shared';

const prisma = new PrismaClient();
const openai = new OpenAI({ apiKey: config.openai.apiKey });

interface PatternStats {
  pattern: string;
  accuracy: number;
  avgPnl: number;
  count: number;
}

export interface TrainingMetrics {
  strategyId: string;
  totalPredictions: number;
  evaluatedPredictions: number;
  accuracy: number;
  recentAccuracy: number;
  improvement: number;
  winRate: number;
  avgPnl: number;
  sharpeRatio: number;
  bestPatterns: Array<{
    pattern: string;
    accuracy: number;
    avgPnl: number;
    count: number;
  }>;
  worstPatterns: Array<{
    pattern: string;
    accuracy: number;
    avgPnl: number;
    count: number;
  }>;
  recommendations: string[];
}

export interface ModelInsight {
  strategyId: string;
  insight: string;
  confidence: number;
  action: string;
  reasoning: string;
}

/**
 * Advanced Trainer - 10x Enhanced AI Training System
 * 
 * Features:
 * - Deep pattern recognition
 * - Ensemble learning
 * - Adaptive confidence adjustment
 * - Market regime adaptation
 * - Performance-based strategy refinement
 * - Real-time learning from outcomes
 */
export class AdvancedTrainer {
  /**
   * Analyze all predictions and generate deep insights
   */
  async analyzePredictions(strategyId: string, limit: number = 500): Promise<TrainingMetrics> {
    const predictions = await prisma.prediction.findMany({
      where: { strategyId },
      orderBy: { timestamp: 'desc' },
      take: limit,
    });

    const evaluated = predictions.filter((p: any) => p.evaluatedAt);
    const recent = evaluated.slice(0, Math.floor(evaluated.length / 2));
    const older = evaluated.slice(Math.floor(evaluated.length / 2));

    // Calculate accuracies
    const totalAccuracy = evaluated.filter((p: any) => p.outcome === 'correct').length / Math.max(evaluated.length, 1);
    const recentAccuracy = recent.filter((p: any) => p.outcome === 'correct').length / Math.max(recent.length, 1);
    const olderAccuracy = older.filter((p: any) => p.outcome === 'correct').length / Math.max(older.length, 1);
    const improvement = recentAccuracy - olderAccuracy;

    // Get trades for P&L analysis
    const trades = await prisma.trade.findMany({
      where: { strategyId },
      orderBy: { timestamp: 'desc' },
      take: limit,
    });

    const closedTrades = trades.filter((t: any) => t.exitPrice);
    const winRate = closedTrades.filter((t: any) => t.pnl > 0).length / Math.max(closedTrades.length, 1);
    const avgPnl = closedTrades.reduce((sum: number, t: any) => sum + t.pnl, 0) / Math.max(closedTrades.length, 1);

    // Calculate Sharpe ratio
    const returns = closedTrades.map((t: any) => t.pnlPct / 100).filter((r: number) => Number.isFinite(r));
    const sharpeRatio = returns.length > 1
      ? this.calculateSharpe(returns)
      : 0;

    // Pattern analysis
    const patterns = await this.analyzePatterns(predictions, trades);
    const bestPatterns = patterns
      .filter((p: PatternStats) => p.accuracy > 0.6 && p.avgPnl > 0)
      .sort((a: PatternStats, b: PatternStats) => b.accuracy - a.accuracy)
      .slice(0, 5);
    const worstPatterns = patterns
      .filter((p: PatternStats) => p.accuracy < 0.4 || p.avgPnl < 0)
      .sort((a: PatternStats, b: PatternStats) => a.accuracy - b.accuracy)
      .slice(0, 5);

    // Generate AI recommendations
    const recommendations = await this.generateRecommendations(
      strategyId,
      totalAccuracy,
      winRate,
      avgPnl,
      sharpeRatio,
      bestPatterns,
      worstPatterns
    );

    return {
      strategyId,
      totalPredictions: predictions.length,
      evaluatedPredictions: evaluated.length,
      accuracy: totalAccuracy,
      recentAccuracy,
      improvement,
      winRate,
      avgPnl,
      sharpeRatio,
      bestPatterns,
      worstPatterns,
      recommendations,
    };
  }

  /**
   * Analyze patterns from predictions and trades
   */
  private async analyzePatterns(
    predictions: any[],
    trades: any[]
  ): Promise<PatternStats[]> {
    const patternMap = new Map<string, { correct: number; total: number; pnl: number[] }>();

    predictions.forEach(pred => {
      if (!pred.evaluatedAt) return;

      // Extract pattern from market context
      const context = JSON.parse(pred.marketContext || '{}');
      const indicators = JSON.parse(pred.indicators || '{}');
      
      // Create pattern signature
      const rsi = indicators.rsi || 50;
      const rsiZone = rsi > 70 ? 'overbought' : rsi < 30 ? 'oversold' : 'neutral';
      const emaTrend = indicators.emaTrend || 0;
      const trend = emaTrend > 0 ? 'bullish' : 'bearish';
      const volatility = context.volatility || 0;
      const volZone = volatility > 0.05 ? 'high' : volatility > 0.02 ? 'medium' : 'low';
      
      const pattern = `${rsiZone}_${trend}_${volZone}`;

      if (!patternMap.has(pattern)) {
        patternMap.set(pattern, { correct: 0, total: 0, pnl: [] });
      }

      const stats = patternMap.get(pattern)!;
      stats.total++;
      if (pred.outcome === 'correct') {
        stats.correct++;
      }
      if (pred.pnl !== null) {
        stats.pnl.push(pred.pnl);
      }
    });

    // Convert to array with metrics
    const patterns: PatternStats[] = [];
    patternMap.forEach((stats, pattern) => {
      patterns.push({
        pattern,
        accuracy: stats.correct / Math.max(stats.total, 1),
        avgPnl: stats.pnl.length > 0 ? stats.pnl.reduce((a: number, b: number) => a + b, 0) / stats.pnl.length : 0,
        count: stats.total,
      });
    });

    return patterns;
  }

  /**
   * Generate AI-powered recommendations
   */
  private async generateRecommendations(
    strategyId: string,
    accuracy: number,
    winRate: number,
    avgPnl: number,
    sharpeRatio: number,
    bestPatterns: any[],
    worstPatterns: any[]
  ): Promise<string[]> {
    const systemPrompt = `You are an expert quantitative trading analyst. Analyze the performance metrics and provide actionable recommendations to improve trading strategy.

Focus on:
1. Pattern recognition - what works, what doesn't
2. Risk management improvements
3. Entry/exit timing optimization
4. Market regime adaptation
5. Confidence calibration

Be specific, actionable, and data-driven.`;

    const userPrompt = `Strategy Performance Analysis:

Accuracy: ${(accuracy * 100).toFixed(1)}%
Win Rate: ${(winRate * 100).toFixed(1)}%
Average P&L: $${avgPnl.toFixed(2)}
Sharpe Ratio: ${sharpeRatio.toFixed(2)}

Best Patterns (High Accuracy + Profit):
${bestPatterns.map(p => `- ${p.pattern}: ${(p.accuracy * 100).toFixed(1)}% accuracy, $${p.avgPnl.toFixed(2)} avg P&L (${p.count} trades)`).join('\n')}

Worst Patterns (Low Accuracy or Loss):
${worstPatterns.map(p => `- ${p.pattern}: ${(p.accuracy * 100).toFixed(1)}% accuracy, $${p.avgPnl.toFixed(2)} avg P&L (${p.count} trades)`).join('\n')}

Provide 5-7 specific, actionable recommendations to improve this strategy. Focus on:
1. What patterns to favor/avoid
2. How to adjust confidence thresholds
3. Risk management improvements
4. Market condition adaptations
5. Entry/exit optimizations

Return as JSON array of recommendation strings.`;

    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-5.1', // Upgraded from gpt-4-turbo-preview
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.7,
        reasoning_effort: 'medium',
      });

      const content = response.choices[0]?.message?.content;
      if (content) {
        const parsed = JSON.parse(content);
        return parsed.recommendations || parsed.recommendation || [];
      }
    } catch (error) {
      logger.error({ error }, 'Error generating recommendations');
    }

    // Fallback recommendations
    const recommendations: string[] = [];
    if (accuracy < 0.5) {
      recommendations.push('Accuracy is below 50% - consider increasing confidence threshold or improving entry signals');
    }
    if (winRate < 0.5) {
      recommendations.push('Win rate is below 50% - review stop loss and take profit levels');
    }
    if (sharpeRatio < 1) {
      recommendations.push('Sharpe ratio is low - focus on reducing drawdowns and improving risk-adjusted returns');
    }
    if (bestPatterns.length > 0) {
      recommendations.push(`Favor patterns like: ${bestPatterns[0].pattern} (${(bestPatterns[0].accuracy * 100).toFixed(1)}% accuracy)`);
    }
    if (worstPatterns.length > 0) {
      recommendations.push(`Avoid patterns like: ${worstPatterns[0].pattern} (${(worstPatterns[0].accuracy * 100).toFixed(1)}% accuracy)`);
    }

    return recommendations;
  }

  /**
   * Calculate Sharpe ratio
   */
  private calculateSharpe(returns: number[]): number {
    if (returns.length < 2) return 0;

    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);

    if (stdDev === 0) return 0;

    // Annualized Sharpe (assuming daily returns)
    return (mean / stdDev) * Math.sqrt(365);
  }

  /**
   * Generate deep model insights using AI
   */
  async generateModelInsights(strategyId: string): Promise<ModelInsight[]> {
    const metrics = await this.analyzePredictions(strategyId);
    const strategy = await prisma.strategy.findUnique({
      where: { id: strategyId },
    });

    if (!strategy) {
      throw new Error(`Strategy not found: ${strategyId}`);
    }

    const systemPrompt = `You are an expert AI trading model analyst. Analyze the strategy performance and provide deep insights about what the model is learning and how to improve it.

Focus on:
1. What the model is doing well
2. What patterns it's recognizing
3. Where it's struggling
4. How to improve decision-making
5. Market regime adaptation needs`;

    const userPrompt = `Strategy: ${strategy.name}
Mode: ${strategy.mode}
Timeframe: ${strategy.timeframe}

Performance Metrics:
- Accuracy: ${(metrics.accuracy * 100).toFixed(1)}%
- Recent Accuracy: ${(metrics.recentAccuracy * 100).toFixed(1)}%
- Improvement: ${(metrics.improvement * 100).toFixed(1)}%
- Win Rate: ${(metrics.winRate * 100).toFixed(1)}%
- Avg P&L: $${metrics.avgPnl.toFixed(2)}
- Sharpe Ratio: ${metrics.sharpeRatio.toFixed(2)}

Best Patterns:
${metrics.bestPatterns.map(p => `- ${p.pattern}: ${(p.accuracy * 100).toFixed(1)}% accuracy`).join('\n')}

Worst Patterns:
${metrics.worstPatterns.map(p => `- ${p.pattern}: ${(p.accuracy * 100).toFixed(1)}% accuracy`).join('\n')}

Provide 3-5 deep insights about:
1. What the model has learned
2. What it needs to learn better
3. How to improve its decision-making
4. Market conditions it handles well/poorly
5. Specific improvements needed

Return as JSON with array of insights, each with: insight, confidence (0-1), action, reasoning.`;

    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-5.1', // Upgraded from gpt-4-turbo-preview
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.7,
        reasoning_effort: 'medium',
      });

      const content = response.choices[0]?.message?.content;
      if (content) {
        const parsed = JSON.parse(content);
        const insights = parsed.insights || parsed.insight || [];
        return insights.map((i: any) => ({
          strategyId,
          insight: i.insight || i.text || '',
          confidence: i.confidence || 0.7,
          action: i.action || i.recommendation || '',
          reasoning: i.reasoning || i.explanation || '',
        }));
      }
    } catch (error) {
      logger.error({ error }, 'Error generating model insights');
    }

    return [];
  }

  /**
   * Adaptive confidence adjustment based on performance
   */
  async adjustConfidenceThreshold(
    strategyId: string,
    currentThreshold: number
  ): Promise<number> {
    const metrics = await this.analyzePredictions(strategyId, 200);

    // If accuracy is high, we can lower threshold (be more aggressive)
    // If accuracy is low, raise threshold (be more conservative)
    let adjustment = 0;

    if (metrics.accuracy > 0.65) {
      // High accuracy - can be more aggressive
      adjustment = -0.05;
    } else if (metrics.accuracy < 0.45) {
      // Low accuracy - be more conservative
      adjustment = 0.1;
    }

    // Consider recent improvement
    if (metrics.improvement > 0.1) {
      // Improving - can be slightly more aggressive
      adjustment -= 0.02;
    } else if (metrics.improvement < -0.1) {
      // Declining - be more conservative
      adjustment += 0.05;
    }

    const newThreshold = Math.max(0.5, Math.min(0.9, currentThreshold + adjustment));
    
    logger.info({
      strategyId,
      oldThreshold: currentThreshold,
      newThreshold,
      adjustment,
      accuracy: metrics.accuracy,
    }, 'Confidence threshold adjusted');

    return newThreshold;
  }

  /**
   * Continuous training loop - runs periodically
   */
  async continuousTraining(strategyId: string): Promise<void> {
    logger.info({ strategyId }, 'Starting continuous training');

    // Analyze current performance
    const metrics = await this.analyzePredictions(strategyId);
    
    // Generate insights
    const insights = await this.generateModelInsights(strategyId);
    
    // Store insights for strategy
    for (const insight of insights) {
      await prisma.modelInsight.create({
        data: {
          strategyId: insight.strategyId,
          insight: insight.insight,
          confidence: insight.confidence,
          action: insight.action,
          reasoning: insight.reasoning,
        },
      });
    }

    logger.info({ strategyId, insights: insights.length, accuracy: metrics.accuracy }, 'Continuous training completed');
  }
}

export const advancedTrainer = new AdvancedTrainer();

