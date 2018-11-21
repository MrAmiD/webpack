/*
	MIT License http://www.opensource.org/licenses/mit-license.php
*/

"use strict";

const RuntimeGlobals = require("../RuntimeGlobals");
const RuntimeModule = require("../RuntimeModule");
const Template = require("../Template");

class EnsureChunkRuntimeModule extends RuntimeModule {
	constructor(chunk, chunkGraph) {
		super("ensure chunk");
		this.chunk = chunk;
		this.chunkGraph = chunkGraph;
	}

	/**
	 * @returns {string} runtime code
	 */
	generate() {
		const { chunk, chunkGraph } = this;
		// Check if there are non initial chunks which need to be imported using require-ensure
		if (chunk.hasAsyncChunks()) {
			const handlers = RuntimeGlobals.ensureChunkHandlers;
			return Template.asString([
				"// This file contains only the entry chunk.",
				"// The chunk loading function for additional chunks",

				`${RuntimeGlobals.ensureChunk} = function requireEnsure(chunkId) {`,
				Template.indent([
					`return Promise.all(${handlers}.reduce(function(h) { return h(chunkId, promises); }, []));`
				]),
				"};"
			]);
		} else if (
			chunkGraph.hasModuleInGraph(chunk, m =>
				m.blocks.some(b => {
					const chunkGroup = chunkGraph.getBlockChunkGroup(b);
					return chunkGroup && chunkGroup.chunks.length > 0;
				})
			)
		) {
			// There async blocks in the graph, so we need to add an empty requireEnsure
			// function anyway. This can happen with multiple entrypoints.
			return Template.asString([
				"// The chunk loading function for additional chunks",
				"// Since all referenced chunks are already included",
				"// in this file, this function is empty here.",
				`${RuntimeGlobals.ensureChunk} = function requireEnsure() {`,
				Template.indent("return Promise.resolve();"),
				"};"
			]);
		}
	}
}

module.exports = EnsureChunkRuntimeModule;
