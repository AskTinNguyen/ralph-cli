/**
 * Nightly Data Collector
 *
 * Extensible framework for gathering data from multiple sources:
 * - Database queries (PostgreSQL, MySQL, SQLite, MongoDB)
 * - Analytics APIs (Mixpanel, Amplitude, Google Analytics)
 * - Custom data sources via plugins
 * - Local metrics from Ralph runs
 */

const fs = require("fs");
const path = require("path");

/**
 * Built-in data source types
 */
const DATA_SOURCE_TYPES = {
  POSTGRESQL: "postgresql",
  MYSQL: "mysql",
  SQLITE: "sqlite",
  MONGODB: "mongodb",
  HTTP_API: "http_api",
  MIXPANEL: "mixpanel",
  AMPLITUDE: "amplitude",
  GOOGLE_ANALYTICS: "google_analytics",
  RALPH_METRICS: "ralph_metrics",
  CUSTOM: "custom",
};

/**
 * Base collector class - extend this for custom sources
 */
class DataCollector {
  constructor(config) {
    this.config = config;
    this.name = config.name || "unnamed";
    this.type = config.type || DATA_SOURCE_TYPES.CUSTOM;
  }

  async connect() {
    throw new Error("connect() must be implemented by subclass");
  }

  async collect() {
    throw new Error("collect() must be implemented by subclass");
  }

  async disconnect() {
    // Optional cleanup
  }
}

/**
 * PostgreSQL collector
 */
class PostgreSQLCollector extends DataCollector {
  constructor(config) {
    super({ ...config, type: DATA_SOURCE_TYPES.POSTGRESQL });
    this.client = null;
  }

  async connect() {
    try {
      const { Client } = require("pg");
      this.client = new Client({
        connectionString: this.config.connectionString || process.env.DATABASE_URL,
        ...this.config.options,
      });
      await this.client.connect();
    } catch (err) {
      throw new Error(`PostgreSQL connection failed: ${err.message}`);
    }
  }

  async collect() {
    if (!this.client) throw new Error("Not connected");

    const results = {};
    for (const query of this.config.queries || []) {
      try {
        const res = await this.client.query(query.sql, query.params || []);
        results[query.name] = {
          rows: res.rows,
          rowCount: res.rowCount,
          description: query.description,
        };
      } catch (err) {
        results[query.name] = { error: err.message };
      }
    }
    return results;
  }

  async disconnect() {
    if (this.client) {
      await this.client.end();
      this.client = null;
    }
  }
}

/**
 * MySQL collector
 */
class MySQLCollector extends DataCollector {
  constructor(config) {
    super({ ...config, type: DATA_SOURCE_TYPES.MYSQL });
    this.connection = null;
  }

  async connect() {
    try {
      const mysql = require("mysql2/promise");
      this.connection = await mysql.createConnection({
        uri: this.config.connectionString || process.env.MYSQL_URL,
        ...this.config.options,
      });
    } catch (err) {
      throw new Error(`MySQL connection failed: ${err.message}`);
    }
  }

  async collect() {
    if (!this.connection) throw new Error("Not connected");

    const results = {};
    for (const query of this.config.queries || []) {
      try {
        const [rows] = await this.connection.execute(query.sql, query.params || []);
        results[query.name] = {
          rows,
          rowCount: rows.length,
          description: query.description,
        };
      } catch (err) {
        results[query.name] = { error: err.message };
      }
    }
    return results;
  }

  async disconnect() {
    if (this.connection) {
      await this.connection.end();
      this.connection = null;
    }
  }
}

/**
 * SQLite collector
 */
class SQLiteCollector extends DataCollector {
  constructor(config) {
    super({ ...config, type: DATA_SOURCE_TYPES.SQLITE });
    this.db = null;
  }

  async connect() {
    try {
      const Database = require("better-sqlite3");
      this.db = new Database(this.config.path || this.config.connectionString);
    } catch (err) {
      throw new Error(`SQLite connection failed: ${err.message}`);
    }
  }

  async collect() {
    if (!this.db) throw new Error("Not connected");

    const results = {};
    for (const query of this.config.queries || []) {
      try {
        const stmt = this.db.prepare(query.sql);
        const rows = stmt.all(...(query.params || []));
        results[query.name] = {
          rows,
          rowCount: rows.length,
          description: query.description,
        };
      } catch (err) {
        results[query.name] = { error: err.message };
      }
    }
    return results;
  }

  async disconnect() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

/**
 * HTTP API collector (generic REST/JSON APIs)
 */
class HTTPAPICollector extends DataCollector {
  constructor(config) {
    super({ ...config, type: DATA_SOURCE_TYPES.HTTP_API });
  }

  async connect() {
    // No persistent connection needed
  }

  async collect() {
    const results = {};

    for (const endpoint of this.config.endpoints || []) {
      try {
        const url = endpoint.url;
        const options = {
          method: endpoint.method || "GET",
          headers: {
            "Content-Type": "application/json",
            ...this.config.headers,
            ...endpoint.headers,
          },
        };

        if (endpoint.body) {
          options.body = JSON.stringify(endpoint.body);
        }

        const response = await fetch(url, options);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        // Apply transform if specified
        const transformed = endpoint.transform
          ? endpoint.transform(data)
          : data;

        results[endpoint.name] = {
          data: transformed,
          description: endpoint.description,
        };
      } catch (err) {
        results[endpoint.name] = { error: err.message };
      }
    }
    return results;
  }
}

/**
 * Ralph metrics collector - gathers data from Ralph's own runs
 */
class RalphMetricsCollector extends DataCollector {
  constructor(config) {
    super({ ...config, type: DATA_SOURCE_TYPES.RALPH_METRICS });
    this.cwd = config.cwd || process.cwd();
  }

  async connect() {
    // No connection needed - reads local files
  }

  async collect() {
    const results = {
      builds: { data: [], description: "Recent build metrics" },
      tokens: { data: {}, description: "Token usage and costs" },
      guardrails: { data: [], description: "Learned guardrails" },
      trends: { data: {}, description: "Performance trends" },
    };

    const ralphDir = path.join(this.cwd, ".ralph");
    if (!fs.existsSync(ralphDir)) {
      return results;
    }

    // Collect from all PRD directories
    const prdDirs = fs.readdirSync(ralphDir)
      .filter(d => /^PRD-\d+$/i.test(d))
      .map(d => path.join(ralphDir, d));

    let totalCost = 0;
    let totalRuns = 0;
    let successCount = 0;
    let recentBuilds = [];

    for (const prdDir of prdDirs) {
      // Cost data
      const costFile = path.join(prdDir, ".cost.json");
      if (fs.existsSync(costFile)) {
        try {
          const cost = JSON.parse(fs.readFileSync(costFile, "utf-8"));
          totalCost += cost.total_cost || 0;
        } catch {}
      }

      // Runs data
      const runsDir = path.join(prdDir, "runs");
      if (fs.existsSync(runsDir)) {
        const runFiles = fs.readdirSync(runsDir)
          .filter(f => f.endsWith(".json"))
          .sort()
          .reverse()
          .slice(0, 10); // Last 10 runs

        for (const runFile of runFiles) {
          try {
            const run = JSON.parse(fs.readFileSync(path.join(runsDir, runFile), "utf-8"));
            totalRuns++;
            if (run.status === "success") successCount++;
            recentBuilds.push({
              prd: path.basename(prdDir),
              timestamp: run.timestamp || runFile.replace(".json", ""),
              status: run.status,
              duration: run.duration,
              story: run.story_id,
            });
          } catch {}
        }
      }
    }

    // Guardrails
    const guardrailsPath = path.join(ralphDir, "guardrails.md");
    if (fs.existsSync(guardrailsPath)) {
      const content = fs.readFileSync(guardrailsPath, "utf-8");
      const lines = content.split("\n").filter(l => l.startsWith("- "));
      results.guardrails.data = lines.map(l => l.replace(/^- /, ""));
    }

    results.builds.data = recentBuilds.slice(0, 20);
    results.tokens.data = {
      totalCost,
      totalRuns,
      successRate: totalRuns > 0 ? Math.round((successCount / totalRuns) * 100) : 0,
      avgCostPerRun: totalRuns > 0 ? totalCost / totalRuns : 0,
    };

    // Calculate trends (last 7 days vs previous 7 days)
    const now = Date.now();
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    const twoWeeksAgo = now - 14 * 24 * 60 * 60 * 1000;

    const thisWeek = recentBuilds.filter(b => {
      const ts = new Date(b.timestamp).getTime();
      return ts >= weekAgo;
    });
    const lastWeek = recentBuilds.filter(b => {
      const ts = new Date(b.timestamp).getTime();
      return ts >= twoWeeksAgo && ts < weekAgo;
    });

    const thisWeekSuccess = thisWeek.filter(b => b.status === "success").length;
    const lastWeekSuccess = lastWeek.filter(b => b.status === "success").length;

    results.trends.data = {
      buildsThisWeek: thisWeek.length,
      buildsLastWeek: lastWeek.length,
      successRateThisWeek: thisWeek.length > 0 ? Math.round((thisWeekSuccess / thisWeek.length) * 100) : 0,
      successRateLastWeek: lastWeek.length > 0 ? Math.round((lastWeekSuccess / lastWeek.length) * 100) : 0,
      trend: thisWeek.length > lastWeek.length ? "up" : thisWeek.length < lastWeek.length ? "down" : "stable",
    };

    return results;
  }
}

/**
 * Create a collector instance based on config
 */
function createCollector(config) {
  switch (config.type) {
    case DATA_SOURCE_TYPES.POSTGRESQL:
      return new PostgreSQLCollector(config);
    case DATA_SOURCE_TYPES.MYSQL:
      return new MySQLCollector(config);
    case DATA_SOURCE_TYPES.SQLITE:
      return new SQLiteCollector(config);
    case DATA_SOURCE_TYPES.HTTP_API:
      return new HTTPAPICollector(config);
    case DATA_SOURCE_TYPES.RALPH_METRICS:
      return new RalphMetricsCollector(config);
    default:
      throw new Error(`Unknown collector type: ${config.type}`);
  }
}

/**
 * Collect data from all configured sources
 */
async function collectAll(sources, options = {}) {
  const results = {
    timestamp: new Date().toISOString(),
    sources: {},
    errors: [],
  };

  for (const sourceConfig of sources) {
    const sourceName = sourceConfig.name || sourceConfig.type;

    try {
      const collector = createCollector(sourceConfig);
      await collector.connect();

      try {
        const data = await collector.collect();
        results.sources[sourceName] = {
          type: sourceConfig.type,
          data,
          collectedAt: new Date().toISOString(),
        };
      } finally {
        await collector.disconnect();
      }
    } catch (err) {
      results.errors.push({
        source: sourceName,
        error: err.message,
      });

      if (options.verbose) {
        console.error(`Error collecting from ${sourceName}: ${err.message}`);
      }
    }
  }

  return results;
}

/**
 * Load collector config from file
 */
function loadConfig(configPath) {
  if (!fs.existsSync(configPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(configPath, "utf-8");
    return JSON.parse(content);
  } catch (err) {
    throw new Error(`Failed to load collector config: ${err.message}`);
  }
}

module.exports = {
  DATA_SOURCE_TYPES,
  DataCollector,
  PostgreSQLCollector,
  MySQLCollector,
  SQLiteCollector,
  HTTPAPICollector,
  RalphMetricsCollector,
  createCollector,
  collectAll,
  loadConfig,
};
