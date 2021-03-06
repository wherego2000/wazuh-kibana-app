/*
 * Wazuh app - Class for Wazuh-Elastic functions
 * Copyright (C) 2018 Wazuh, Inc.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 *
 * Find more information about this on the LICENSE file.
 */
import { ElasticWrapper } from '../lib/elastic-wrapper';
import { ErrorResponse } from './error-response';
import { log } from '../logger';

import {
  AgentsVisualizations,
  OverviewVisualizations,
  ClusterVisualizations
} from '../integration-files/visualizations';

export class WazuhElasticCtrl {
  constructor(server) {
    this.wzWrapper = new ElasticWrapper(server);
  }

  async getTimeStamp(req, reply) {
    try {
      const data = await this.wzWrapper.getWazuhVersionIndexAsSearch();

      if (
        data.hits &&
        data.hits.hits[0] &&
        data.hits.hits[0]._source &&
        data.hits.hits[0]._source.installationDate &&
        data.hits.hits[0]._source.lastRestart
      ) {
        return reply({
          installationDate: data.hits.hits[0]._source.installationDate,
          lastRestart: data.hits.hits[0]._source.lastRestart
        });
      } else {
        throw new Error('Could not fetch .wazuh-version index');
      }
    } catch (error) {
      return ErrorResponse(
        error.message || 'Could not fetch .wazuh-version index',
        4001,
        500,
        reply
      );
    }
  }

  async getTemplate(req, reply) {
    try {
      if (!req.params || !req.params.pattern) {
        throw new Error(
          'An index pattern is needed for checking the Elasticsearch template existance'
        );
      }

      const data = await this.wzWrapper.getTemplates();

      if (!data || typeof data !== 'string') {
        throw new Error(
          'An unknown error occurred when fetching templates from Elasticseach'
        );
      }

      const lastChar = req.params.pattern[req.params.pattern.length - 1];
      const array = data
        .match(/[^\s]+/g)
        .filter(item => item.includes('[') && item.includes(']'));
      const pattern =
        lastChar === '*' ? req.params.pattern.slice(0, -1) : req.params.pattern;
      const isIncluded = array.filter(item => item.includes(pattern));

      return isIncluded && Array.isArray(isIncluded) && isIncluded.length
        ? reply({
            statusCode: 200,
            status: true,
            data: `Template found for ${req.params.pattern}`
          })
        : reply({
            statusCode: 200,
            status: false,
            data: `No template found for ${req.params.pattern}`
          });
    } catch (error) {
      log('GET /api/wazuh-elastic/template/{pattern}', error.message || error);
      return ErrorResponse(
        `Could not retrieve templates from Elasticsearch due to ${error.message ||
          error}`,
        4002,
        500,
        reply
      );
    }
  }

  async checkPattern(req, reply) {
    try {
      const response = await this.wzWrapper.getAllIndexPatterns();

      const filtered = response.hits.hits.filter(
        item => item._source['index-pattern'].title === req.params.pattern
      );

      return filtered.length >= 1
        ? reply({ statusCode: 200, status: true, data: 'Index pattern found' })
        : reply({
            statusCode: 500,
            status: false,
            error: 10020,
            message: 'Index pattern not found'
          });
    } catch (error) {
      log('GET /api/wazuh-elastic/pattern/{pattern}', error.message || error);
      return ErrorResponse(
        `Something went wrong retrieving index-patterns from Elasticsearch due to ${error.message ||
          error}`,
        4003,
        500,
        reply
      );
    }
  }

  async getFieldTop(req, reply) {
    try {
      // Top field payload
      let payload = {
        size: 1,
        query: {
          bool: {
            must: [],
            filter: { range: { '@timestamp': {} } }
          }
        },
        aggs: {
          '2': {
            terms: {
              field: '',
              size: 1,
              order: { _count: 'desc' }
            }
          }
        }
      };

      // Set up time interval, default to Last 24h
      const timeGTE = 'now-1d';
      const timeLT = 'now';
      payload.query.bool.filter.range['@timestamp']['gte'] = timeGTE;
      payload.query.bool.filter.range['@timestamp']['lt'] = timeLT;

      // Set up match for default cluster name
      payload.query.bool.must.push(
        req.params.mode === 'cluster'
          ? { match: { 'cluster.name': req.params.cluster } }
          : { match: { 'manager.name': req.params.cluster } }
      );

      payload.aggs['2'].terms.field = req.params.field;
      payload.pattern = req.params.pattern;
      const data = await this.wzWrapper.searchWazuhAlertsWithPayload(payload);

      return data.hits.total === 0 ||
        typeof data.aggregations['2'].buckets[0] === 'undefined'
        ? reply({ statusCode: 200, data: '' })
        : reply({
            statusCode: 200,
            data: data.aggregations['2'].buckets[0].key
          });
    } catch (error) {
      return ErrorResponse(error.message || error, 4004, 500, reply);
    }
  }

  async getSetupInfo(req, reply) {
    try {
      const data = await this.wzWrapper.getWazuhVersionIndexAsSearch();

      return data.hits.total === 0
        ? reply({ statusCode: 200, data: '' })
        : reply({ statusCode: 200, data: data.hits.hits[0]._source });
    } catch (error) {
      log('GET /api/wazuh-elastic/setup', error.message || error);
      return ErrorResponse(
        `Could not get data from elasticsearch due to ${error.message ||
          error}`,
        4005,
        500,
        reply
      );
    }
  }

  /**
   * Checks one by one if the requesting user has enough privileges to use
   * an index pattern from the list.
   * @param {Array<Object>} list List of index patterns
   * @param {*} req
   */
  async filterAllowedIndexPatternList(list, req) {
    let finalList = [];
    for (let item of list) {
      let results = false,
        forbidden = false;
      try {
        results = await this.wzWrapper.searchWazuhElementsByIndexWithRequest(
          req,
          item.title
        );
      } catch (error) {
        forbidden = true;
      }
      if (
        (results && results.hits && results.hits.total >= 1) ||
        (!forbidden && results && results.hits && results.hits.total === 0)
      ) {
        finalList.push(item);
      }
    }
    return finalList;
  }

  /**
   * Checks for minimum index pattern fields in a list of index patterns.
   * @param {Array<Object>} indexPatternList List of index patterns
   */
  validateIndexPattern(indexPatternList) {
    const minimum = ['@timestamp', 'full_log', 'manager.name', 'agent.id'];
    let list = [];
    for (const index of indexPatternList) {
      let valid, parsed;
      try {
        parsed = JSON.parse(index._source['index-pattern'].fields);
      } catch (error) {
        continue;
      }

      valid = parsed.filter(item => minimum.includes(item.name));
      if (valid.length === 4) {
        list.push({
          id: index._id.split('index-pattern:')[1],
          title: index._source['index-pattern'].title
        });
      }
    }
    return list;
  }

  async getlist(req, reply) {
    try {
      const xpack = await this.wzWrapper.getPlugins();

      const isXpackEnabled =
        typeof XPACK_RBAC_ENABLED !== 'undefined' &&
        XPACK_RBAC_ENABLED &&
        typeof xpack === 'string' &&
        xpack.includes('x-pack');

      const isSuperUser =
        isXpackEnabled &&
        req.auth &&
        req.auth.credentials &&
        req.auth.credentials.roles &&
        req.auth.credentials.roles.includes('superuser');

      const data = await this.wzWrapper.getAllIndexPatterns();

      if (data && data.hits && data.hits.hits.length === 0)
        throw new Error('There is no index pattern');

      if (data && data.hits && data.hits.hits) {
        const list = this.validateIndexPattern(data.hits.hits);

        return reply({
          data:
            isXpackEnabled && !isSuperUser
              ? await this.filterAllowedIndexPatternList(list, req)
              : list
        });
      }

      throw new Error(
        "The Elasticsearch request didn't fetch the expected data"
      );
    } catch (error) {
      log('GET /get-list', error.message || error);
      return ErrorResponse(error.message || error, 4006, 500, reply);
    }
  }

  /**
   * Replaces visualizations main fields to fit a certain pattern.
   * @param {Array<Object>} app_objects Object containing raw visualizations.
   * @param {String} id Index-pattern id to use in the visualizations. Eg: 'wazuh-alerts'
   */
  buildVisualizationsRaw(app_objects, id) {
    try {
      const visArray = [];
      let aux_source, bulk_content;
      for (let element of app_objects) {
        // Stringify and replace index-pattern for visualizations
        aux_source = JSON.stringify(element._source);
        aux_source = aux_source.replace('wazuh-alerts', id);
        aux_source = JSON.parse(aux_source);

        // Bulk source
        bulk_content = {};
        bulk_content[element._type] = aux_source;

        visArray.push({
          attributes: bulk_content.visualization,
          type: element._type,
          id: element._id,
          _version: bulk_content.visualization.version
        });
      }
      return visArray;
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /**
   * Replaces cluster visualizations main fields.
   * @param {Array<Object>} app_objects Object containing raw visualizations.
   * @param {String} id Index-pattern id to use in the visualizations. Eg: 'wazuh-alerts'
   * @param {Array<String>} nodes Array of node names. Eg: ['node01', 'node02']
   * @param {String} name Cluster name. Eg: 'wazuh'
   * @param {String} master_node Master node name. Eg: 'node01'
   */
  buildClusterVisualizationsRaw(
    app_objects,
    id,
    nodes = [],
    name,
    master_node,
    pattern_name = '*'
  ) {
    try {
      const visArray = [];
      let aux_source, bulk_content;

      for (const element of app_objects) {
        // Stringify and replace index-pattern for visualizations
        aux_source = JSON.stringify(element._source);
        aux_source = aux_source.replace('wazuh-alerts', id);
        aux_source = JSON.parse(aux_source);

        // Bulk source
        bulk_content = {};
        bulk_content[element._type] = aux_source;

        const visState = JSON.parse(bulk_content.visualization.visState);
        const title = visState.title;

        if (visState.type && visState.type === 'timelion') {
          let query = '';
          if (title === 'Wazuh App Cluster Overview') {
            for (const node of nodes) {
              query += `.es(index=${pattern_name},q="cluster.name: ${name} AND cluster.node: ${
                node.name
              }").label("${node.name}"),`;
            }
            query = query.substring(0, query.length - 1);
          } else if (title === 'Wazuh App Cluster Overview Manager') {
            query += `.es(index=${pattern_name},q="cluster.name: ${name}").label("${name} cluster")`;
          }

          visState.params.expression = query;
          bulk_content.visualization.visState = JSON.stringify(visState);
        }

        visArray.push({
          attributes: bulk_content.visualization,
          type: element._type,
          id: element._id,
          _version: bulk_content.visualization.version
        });
      }

      return visArray;
    } catch (error) {
      return Promise.reject(error);
    }
  }

  async createVis(req, reply) {
    try {
      if (
        !req.params.pattern ||
        !req.params.tab ||
        (req.params.tab &&
          !req.params.tab.includes('overview-') &&
          !req.params.tab.includes('agents-'))
      ) {
        throw new Error('Missing parameters creating visualizations');
      }

      const tabPrefix = req.params.tab.includes('overview')
        ? 'overview'
        : 'agents';

      const tabSplit = req.params.tab.split('-');
      const tabSufix = tabSplit[1];

      const file =
        tabPrefix === 'overview'
          ? OverviewVisualizations[tabSufix]
          : AgentsVisualizations[tabSufix];

      const raw = await this.buildVisualizationsRaw(file, req.params.pattern);
      return reply({ acknowledge: true, raw: raw });
    } catch (error) {
      return ErrorResponse(error.message || error, 4007, 500, reply);
    }
  }

  async createClusterVis(req, reply) {
    try {
      if (
        !req.params.pattern ||
        !req.params.tab ||
        !req.payload ||
        !req.payload.nodes ||
        !req.payload.nodes.items ||
        !req.payload.nodes.name ||
        (req.params.tab && !req.params.tab.includes('cluster-'))
      ) {
        throw new Error('Missing parameters creating visualizations');
      }

      const file = ClusterVisualizations['monitoring'];
      const nodes = req.payload.nodes.items;
      const name = req.payload.nodes.name;
      const master_node = req.payload.nodes.master_node;

      const pattern_doc = await this.wzWrapper.getIndexPatternUsingGet(
        req.params.pattern
      );
      const pattern_name = pattern_doc._source['index-pattern'].title;

      const raw = await this.buildClusterVisualizationsRaw(
        file,
        req.params.pattern,
        nodes,
        name,
        master_node,
        pattern_name
      );

      return reply({ acknowledge: true, raw: raw });
    } catch (error) {
      return ErrorResponse(error.message || error, 4009, 500, reply);
    }
  }

  async refreshIndex(req, reply) {
    try {
      if (!req.params.pattern) throw new Error('Missing parameters');

      const output = await this.wzWrapper.updateIndexPatternKnownFields(
        req.params.pattern
      );

      return reply({ acknowledge: true, output: output });
    } catch (error) {
      log('GET /refresh-fields/{pattern}', error.message || error);
      return ErrorResponse(error.message || error, 4008, 500, reply);
    }
  }
}
