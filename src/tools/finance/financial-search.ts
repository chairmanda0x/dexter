import { DynamicStructuredTool, StructuredToolInterface } from '@langchain/core/tools';
import { AIMessage, ToolCall } from '@langchain/core/messages';
import { z } from 'zod';
import { callLlm } from '../../model/llm.js';
import { formatToolResult } from '../types.js';
import { getCurrentDate } from '../../agent/prompts.js';

// Import all finance tools directly (avoid circular deps with index.ts)
import { getIncomeStatements, getBalanceSheets, getCashFlowStatements, getAllFinancialStatements } from './fundamentals.js';
import { getFilings, get10KFilingItems, get10QFilingItems, get8KFilingItems } from './filings.js';
import { getPriceSnapshot, getPrices } from './prices.js';
import { getFinancialMetricsSnapshot, getFinancialMetrics } from './metrics.js';
import { getNews } from './news.js';
import { getAnalystEstimates } from './estimates.js';
import { getSegmentedRevenues } from './segments.js';
import { getCryptoPriceSnapshot, getCryptoPrices, getCryptoTickers } from './crypto.js';
import { getInsiderTrades } from './insider_trades.js';
import { getCompanyFacts } from './company_facts.js';

// All finance tools available for routing
const FINANCE_TOOLS: StructuredToolInterface[] = [
  getPriceSnapshot,
  getPrices,
  getCryptoPriceSnapshot,
  getCryptoPrices,
  getCryptoTickers,
  getIncomeStatements,
  getBalanceSheets,
  getCashFlowStatements,
  getAllFinancialStatements,
  getFinancialMetricsSnapshot,
  getFinancialMetrics,
  getAnalystEstimates,
  getFilings,
  get10KFilingItems,
  get10QFilingItems,
  get8KFilingItems,
  getNews,
  getInsiderTrades,
  getSegmentedRevenues,
  getCompanyFacts,
];

const FINANCE_TOOL_MAP = new Map(FINANCE_TOOLS.map(t => [t.name, t]));

function buildRouterPrompt(): string {
  return `You are a financial data routing assistant.
Current date: ${getCurrentDate()}

Given a user's natural language query about financial data, call the appropriate financial tool(s).

## Guidelines

1. **Ticker Resolution**: Convert company names to ticker symbols:
   - Apple → AAPL, Tesla → TSLA, Microsoft → MSFT, Amazon → AMZN
   - Google/Alphabet → GOOGL, Meta/Facebook → META, Nvidia → NVDA

2. **Date Inference**: Convert relative dates to YYYY-MM-DD format:
   - "last year" → start_date 1 year ago, end_date today
   - "last quarter" → start_date 3 months ago, end_date today

3. **Tool Selection**:
   - For "current" or "latest" data, use snapshot tools (get_price_snapshot, get_financial_metrics_snapshot)
   - For revenue, earnings, profitability → get_income_statements
   - For debt, assets, equity → get_balance_sheets
   - For cash flow, free cash flow → get_cash_flow_statements

4. **Efficiency**:
   - Prefer specific tools over general ones when possible

Call the appropriate tool(s) now.`;
}

const FinancialSearchInputSchema = z.object({
  query: z.string().describe('Natural language query about financial data'),
});

export function createFinancialSearch(model: string): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: 'financial_search',
    description: `Intelligent agentic search for financial data. Takes a natural language query and automatically routes to appropriate financial data tools. Use for:
- Stock prices (current or historical)
- Company financials (income statements, balance sheets, cash flow)
- Financial metrics (P/E ratio, market cap, EPS, dividend yield)
- SEC filings (10-K, 10-Q, 8-K)
- Analyst estimates and price targets
- Company news
- Insider trading activity
- Cryptocurrency prices`,
    schema: FinancialSearchInputSchema,
    func: async (input) => {
      console.log('\n🔍 ========================================');
      console.log('🔍 FINANCIAL_SEARCH called with query:', input.query);
      console.log('🔍 Using model:', model);
      console.log('🔍 Available tools:', FINANCE_TOOLS.map(t => t.name).join(', '));
      console.log('🔍 ========================================\n');

      let response: AIMessage;
      try {
        response = await callLlm(input.query, {
          model,
          systemPrompt: buildRouterPrompt(),
          tools: FINANCE_TOOLS,
        }) as AIMessage;
        console.log('📤 LLM Response tool_calls:', JSON.stringify(response?.tool_calls, null, 2));
      } catch (error) {
        console.error('❌ LLM call failed:', error);
        return formatToolResult({ error: `LLM call failed: ${error}` }, []);
      }

      const toolCalls = response.tool_calls as ToolCall[];
      console.log('🔧 Number of tool calls:', toolCalls?.length ?? 0);

      if (!toolCalls || toolCalls.length === 0) {
        console.log('❌ No tool calls returned from LLM!');
        return formatToolResult({ error: 'No tools selected for query' }, []);
      }

      console.log('⚙️ Executing', toolCalls.length, 'tool calls...');
      const results = await Promise.all(
        toolCalls.map(async (tc) => {
          console.log(`⚙️ Executing tool: ${tc.name} with args:`, JSON.stringify(tc.args));
          try {
            const tool = FINANCE_TOOL_MAP.get(tc.name);
            if (!tool) {
              throw new Error(`Tool '${tc.name}' not found`);
            }
            const rawResult = await tool.invoke(tc.args);
            const resultStr = typeof rawResult === 'string' ? rawResult : JSON.stringify(rawResult);
            console.log(`✅ Tool ${tc.name} result preview:`, resultStr.substring(0, 300));
            const parsed = JSON.parse(resultStr);
            return {
              tool: tc.name,
              args: tc.args,
              data: parsed.data,
              sourceUrls: parsed.sourceUrls || [],
              error: null,
            };
          } catch (error) {
            console.error(`❌ Tool ${tc.name} failed:`, error);
            return {
              tool: tc.name,
              args: tc.args,
              data: null,
              sourceUrls: [],
              error: error instanceof Error ? error.message : String(error),
            };
          }
        })
      );

      const successfulResults = results.filter((r) => r.error === null);
      const failedResults = results.filter((r) => r.error !== null);
      console.log(`📊 Results: ${successfulResults.length} successful, ${failedResults.length} failed`);

      const allUrls = results.flatMap((r) => r.sourceUrls);
      const combinedData: Record<string, unknown> = {};

      for (const result of successfulResults) {
        const ticker = (result.args as Record<string, unknown>).ticker as string | undefined;
        const key = ticker ? `${result.tool}_${ticker}` : result.tool;
        combinedData[key] = result.data;
      }

      if (failedResults.length > 0) {
        combinedData._errors = failedResults.map((r) => ({
          tool: r.tool,
          args: r.args,
          error: r.error,
        }));
      }

      console.log('📊 Final data keys:', Object.keys(combinedData));
      return formatToolResult(combinedData, allUrls);
    },
  });
}
