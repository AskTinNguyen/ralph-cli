/**
 * Nightly AI Analyzer
 *
 * Uses Claude Opus 4.5 to analyze collected data and generate
 * actionable recommendations.
 */

const Anthropic = require("@anthropic-ai/sdk").default;

/**
 * Default analysis prompt template
 */
const DEFAULT_ANALYSIS_PROMPT = `You are a senior product strategist and engineering advisor analyzing business data to identify the single most impactful action item.

## Your Role
Analyze the provided data and identify ONE high-priority action that will deliver the most value. Focus on:
- User behavior patterns that reveal opportunities
- Performance metrics that need attention
- Growth opportunities or bottlenecks
- Quick wins with high ROI

## Data to Analyze
{DATA}

## Instructions
1. Review all data sources carefully
2. Identify patterns, anomalies, and opportunities
3. Recommend ONE specific, actionable item
4. Explain the reasoning and expected impact
5. Keep the recommendation concise and implementable within 1-2 days

## Response Format
Respond in this exact JSON format:
{
  "recommendation": {
    "title": "Brief action title (5-10 words)",
    "summary": "One sentence description of the action",
    "details": "2-3 paragraphs explaining the recommendation, reasoning, and expected impact",
    "priority": "critical|high|medium",
    "effort": "small|medium|large",
    "expectedImpact": "Brief description of expected outcomes",
    "dataPoints": ["Key data point 1", "Key data point 2", "Key data point 3"],
    "nextSteps": ["Step 1", "Step 2", "Step 3"]
  },
  "analysis": {
    "keyInsights": ["Insight 1", "Insight 2", "Insight 3"],
    "concerningTrends": ["Trend 1 (if any)"],
    "positiveSignals": ["Signal 1", "Signal 2"]
  },
  "metadata": {
    "dataQuality": "excellent|good|fair|poor",
    "confidence": "high|medium|low",
    "additionalDataNeeded": ["Data type 1 (if any)"]
  }
}`;

/**
 * Analysis result structure
 * @typedef {Object} AnalysisResult
 * @property {boolean} success - Whether analysis succeeded
 * @property {Object} recommendation - The recommendation object
 * @property {Object} analysis - Analysis insights
 * @property {Object} metadata - Analysis metadata
 * @property {string} rawResponse - Raw model response
 * @property {Object} usage - Token usage stats
 * @property {string} error - Error message if failed
 */

/**
 * Analyze collected data using Claude Opus 4.5
 *
 * @param {Object} collectedData - Data from collector
 * @param {Object} options - Analysis options
 * @returns {Promise<AnalysisResult>}
 */
async function analyze(collectedData, options = {}) {
  const {
    apiKey = process.env.ANTHROPIC_API_KEY,
    model = "claude-opus-4-5-20251101",
    maxTokens = 4096,
    customPrompt = null,
    context = {},
  } = options;

  if (!apiKey) {
    return {
      success: false,
      error: "ANTHROPIC_API_KEY not set. Please set it in your environment or config.",
    };
  }

  // Prepare data for analysis
  const dataForAnalysis = prepareDataForAnalysis(collectedData, context);

  // Build the prompt
  const prompt = (customPrompt || DEFAULT_ANALYSIS_PROMPT)
    .replace("{DATA}", JSON.stringify(dataForAnalysis, null, 2));

  try {
    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    // Extract the text response
    const textContent = response.content.find(c => c.type === "text");
    if (!textContent) {
      return {
        success: false,
        error: "No text response from model",
      };
    }

    const rawResponse = textContent.text;

    // Parse JSON from response
    const parsed = parseJSONResponse(rawResponse);
    if (!parsed.success) {
      return {
        success: false,
        error: `Failed to parse model response: ${parsed.error}`,
        rawResponse,
      };
    }

    return {
      success: true,
      recommendation: parsed.data.recommendation,
      analysis: parsed.data.analysis,
      metadata: parsed.data.metadata,
      rawResponse,
      usage: {
        inputTokens: response.usage?.input_tokens,
        outputTokens: response.usage?.output_tokens,
        model: response.model,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: `API call failed: ${err.message}`,
    };
  }
}

/**
 * Prepare collected data for analysis
 */
function prepareDataForAnalysis(collectedData, context = {}) {
  const prepared = {
    collectionTimestamp: collectedData.timestamp,
    context: {
      businessType: context.businessType || "software product",
      goals: context.goals || ["growth", "engagement", "retention"],
      focusAreas: context.focusAreas || [],
      ...context,
    },
    dataSources: {},
  };

  // Process each data source
  for (const [sourceName, sourceData] of Object.entries(collectedData.sources || {})) {
    prepared.dataSources[sourceName] = {
      type: sourceData.type,
      collectedAt: sourceData.collectedAt,
      metrics: {},
    };

    // Flatten and summarize data
    if (sourceData.data) {
      for (const [key, value] of Object.entries(sourceData.data)) {
        if (value.error) {
          prepared.dataSources[sourceName].metrics[key] = { error: value.error };
        } else if (value.rows) {
          // Database query result
          prepared.dataSources[sourceName].metrics[key] = {
            description: value.description,
            rowCount: value.rowCount,
            sample: value.rows.slice(0, 10), // Limit to 10 rows
          };
        } else if (value.data) {
          // API or other data
          prepared.dataSources[sourceName].metrics[key] = {
            description: value.description,
            data: value.data,
          };
        } else {
          prepared.dataSources[sourceName].metrics[key] = value;
        }
      }
    }
  }

  // Add any collection errors
  if (collectedData.errors?.length > 0) {
    prepared.collectionErrors = collectedData.errors;
  }

  return prepared;
}

/**
 * Parse JSON from model response (handles markdown code blocks)
 */
function parseJSONResponse(response) {
  // Try direct parse first
  try {
    return { success: true, data: JSON.parse(response) };
  } catch {}

  // Try extracting from markdown code block
  const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    try {
      return { success: true, data: JSON.parse(jsonMatch[1].trim()) };
    } catch (err) {
      return { success: false, error: `JSON in code block invalid: ${err.message}` };
    }
  }

  // Try finding JSON object in response
  const jsonObjMatch = response.match(/\{[\s\S]*\}/);
  if (jsonObjMatch) {
    try {
      return { success: true, data: JSON.parse(jsonObjMatch[0]) };
    } catch (err) {
      return { success: false, error: `Could not parse JSON object: ${err.message}` };
    }
  }

  return { success: false, error: "No JSON found in response" };
}

/**
 * Generate a quick summary for email subject
 */
function generateEmailSubject(recommendation) {
  if (!recommendation) return "Daily AI Recommendation";

  const priority = recommendation.priority?.toUpperCase() || "";
  const title = recommendation.title || "Action Item";

  if (priority === "CRITICAL") {
    return `🚨 [CRITICAL] ${title}`;
  } else if (priority === "HIGH") {
    return `⚡ [HIGH] ${title}`;
  }
  return `💡 ${title}`;
}

/**
 * Custom analysis prompts for different business types
 */
const ANALYSIS_PROMPTS = {
  saas: `You are analyzing SaaS product metrics. Focus on:
- Monthly Recurring Revenue (MRR) trends
- Churn rate and retention signals
- Feature adoption and engagement
- User onboarding completion rates
- Trial-to-paid conversion
{DATA}`,

  ecommerce: `You are analyzing e-commerce metrics. Focus on:
- Conversion rate optimization opportunities
- Cart abandonment patterns
- Average order value trends
- Customer acquisition cost vs lifetime value
- Inventory and fulfillment issues
{DATA}`,

  marketplace: `You are analyzing marketplace metrics. Focus on:
- Supply and demand balance
- Transaction volume and GMV trends
- Seller/buyer engagement
- Take rate optimization
- Trust and safety signals
{DATA}`,

  devtools: `You are analyzing developer tools metrics. Focus on:
- API usage and adoption patterns
- Integration success rates
- Developer experience friction points
- Documentation engagement
- Support ticket patterns
{DATA}`,
};

module.exports = {
  analyze,
  prepareDataForAnalysis,
  generateEmailSubject,
  DEFAULT_ANALYSIS_PROMPT,
  ANALYSIS_PROMPTS,
};
