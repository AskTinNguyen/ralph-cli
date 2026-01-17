/**
 * Kanban API Routes
 *
 * API endpoints for Kanban board visualization.
 */

import { Hono } from "hono";
import { board } from "./kanban/board.js";

const kanban = new Hono();

// Mount board endpoint
kanban.route("/board", board);

export { kanban };
