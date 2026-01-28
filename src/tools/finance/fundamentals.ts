import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { callApi } from './api.js';
import { formatToolResult } from '../types.js';

const FinancialStatementsInputSchema = z.object({
    ticker: z
      .string()
      .describe("The stock ticker symbol (e.g., 'AAPL' for Apple)."),
    period: z
      .enum(['annual', 'quarterly', 'ttm'])
      .describe("The reporting period: 'annual', 'quarterly', or 'ttm'."),
    limit: z
      .number()
      .default(10)
      .describe('Maximum number of periods to return (default: 10).'),
});

// FMP uses different period values
function mapPeriod(period: string): string {
    if (period === 'quarterly') return 'quarter';
    if (period === 'annual') return 'annual';
    return 'annual'; // ttm maps to annual for FMP
}

export const getIncomeStatements = new DynamicStructuredTool({
    name: 'get_income_statements',
    description: `Fetches a company's income statements with revenues, expenses, net income, etc.`,
    schema: FinancialStatementsInputSchema,
    func: async (input) => {
          const { data, url } = await callApi('/income-statement', {
                  symbol: input.ticker,
                  period: mapPeriod(input.period),
                  limit: input.limit,
          });
          return formatToolResult({ income_statements: data }, [url]);
    },
});

export const getBalanceSheets = new DynamicStructuredTool({
    name: 'get_balance_sheets',
    description: `Retrieves a company's balance sheets showing assets, liabilities, and equity.`,
    schema: FinancialStatementsInputSchema,
    func: async (input) => {
          const { data, url } = await callApi('/balance-sheet-statement', {
                  symbol: input.ticker,
                  period: mapPeriod(input.period),
                  limit: input.limit,
          });
          return formatToolResult({ balance_sheets: data }, [url]);
    },
});

export const getCashFlowStatements = new DynamicStructuredTool({
    name: 'get_cash_flow_statements',
    description: `Retrieves a company's cash flow statements.`,
    schema: FinancialStatementsInputSchema,
    func: async (input) => {
          const { data, url } = await callApi('/cash-flow-statement', {
                  symbol: input.ticker,
                  period: mapPeriod(input.period),
                  limit: input.limit,
          });
          return formatToolResult({ cash_flow_statements: data }, [url]);
    },
});

export const getAllFinancialStatements = new DynamicStructuredTool({
    name: 'get_all_financial_statements',
    description: `Retrieves all three financial statements for comprehensive analysis.`,
    schema: FinancialStatementsInputSchema,
    func: async (input) => {
          const periodParam = mapPeriod(input.period);
          const [income, balance, cashflow] = await Promise.all([
                  callApi('/income-statement', { symbol: input.ticker, period: periodParam, limit: input.limit }),
                  callApi('/balance-sheet-statement', { symbol: input.ticker, period: periodParam, limit: input.limit }),
                  callApi('/cash-flow-statement', { symbol: input.ticker, period: periodParam, limit: input.limit }),
                ]);
          return formatToolResult({
                  income_statements: income.data,
                  balance_sheets: balance.data,
                  cash_flow_statements: cashflow.data,
          }, [income.url]);
    },
});
