/*
 * Wazuh app - Wazuh table directive
 * Copyright (C) 2018 Wazuh, Inc.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 *
 * Find more information about this on the LICENSE file.
 */

import template from './wz-table.html';
import { uiModules } from 'ui/modules';
import { DataFactory } from '../../services/data-factory';
import { KeyEquivalenece } from '../../../util/csv-key-equivalence';
import { calcTableRows } from './wz-table-rows';
import { FilterHandler } from '../../utils/filter-handler';
import ProcessEquivalence from '../../../util/process-state-equivalence';
const app = uiModules.get('app/wazuh', []);

app
  .directive('wzTable', function() {
    return {
      restrict: 'E',
      scope: {
        path: '=path',
        keys: '=keys',
        allowClick: '=allowClick',
        implicitFilter: '=implicitFilter',
        rowSizes: '=rowSizes',
        extraLimit: '=extraLimit'
      },
      controller(
        $scope,
        apiReq,
        $timeout,
        shareAgent,
        $location,
        errorHandler,
        wzTableFilter,
        $window,
        appState,
        globalState
      ) {
        /**
         * Calculate number of table rows depending on the screen height
         */
        const rowSizes = $scope.rowSizes || [15, 13, 11];
        let doit;
        $window.onresize = () => {
          clearTimeout(doit);
          doit = setTimeout(() => {
            $scope.rowsPerPage = calcTableRows($window.innerHeight, rowSizes);
            $scope.itemsPerPage = $scope.rowsPerPage;
            init();
          }, 150);
        };
        $scope.rowsPerPage = calcTableRows($window.innerHeight, rowSizes);

        $scope.keyEquivalence = KeyEquivalenece;
        $scope.totalItems = 0;

        $scope.clickAction = item => {
          if (
            instance.path === '/agents' ||
            new RegExp(/^\/agents\/groups\/[a-zA-Z0-9]*$/).test(instance.path)
          ) {
            shareAgent.setAgent(item);
            $location.search('tab', null);
            $location.path('/agents');
          } else if (instance.path === '/agents/groups') {
            $scope.$emit('wazuhShowGroup', { group: item });
          } else if (
            new RegExp(/^\/agents\/groups\/[a-zA-Z0-9]*\/files$/).test(
              instance.path
            )
          ) {
            $scope.$emit('wazuhShowGroupFile', {
              groupName: instance.path.split('groups/')[1].split('/files')[0],
              fileName: item.filename
            });
          } else if (instance.path === '/rules') {
            $scope.$emit('wazuhShowRule', { rule: item });
          } else if (instance.path.includes('/decoders')) {
            $scope.$emit('wazuhShowDecoder', { decoder: item });
          } else if (instance.path === '/cluster/nodes') {
            $scope.$emit('wazuhShowClusterNode', { node: item });
          }
        };

        if ($scope.path.includes('/rules')) {
          try {
            const filterHandler = new FilterHandler(
              appState.getCurrentPattern()
            );

            const checkGlobalFilters = () => {
              if (!globalState.filters || !Array.isArray(globalState.filters)) {
                globalState.filters = [];
              }
            };

            $scope.searchRuleId = (e, ruleId) => {
              e.stopPropagation();
              checkGlobalFilters();
              const ruleIdFilter = filterHandler.ruleIdQuery(ruleId);
              if (globalState.filters.length) {
                globalState.filters = globalState.filters.filter(
                  item => item && item.meta && item.meta.key !== 'rule.id'
                );
              }
              globalState.filters.push(ruleIdFilter);
              $window.location.href = '#/wazuh-discover';
            };
          } catch (error) {} // eslint-disable-line
        }

        let realTime = false;

        $scope.wazuh_table_loading = true;
        //// PAGINATION ////////////////////
        $scope.itemsPerPage = $scope.rowsPerPage || 10;
        $scope.pagedItems = [];
        $scope.currentPage = 0;
        let items = [];
        $scope.gap = 0;

        // init the filtered items
        $scope.searchTable = function() {
          $scope.filteredItems = items;
          $scope.currentPage = 0;
          // now group by pages
          $scope.groupToPages();
        };

        // calculate page in place
        $scope.groupToPages = function() {
          $scope.pagedItems = [];

          for (let i = 0; i < $scope.filteredItems.length; i++) {
            if (i % $scope.itemsPerPage === 0) {
              $scope.pagedItems[Math.floor(i / $scope.itemsPerPage)] = [
                $scope.filteredItems[i]
              ];
            } else {
              $scope.pagedItems[Math.floor(i / $scope.itemsPerPage)].push(
                $scope.filteredItems[i]
              );
            }
          }
        };

        $scope.range = function(size, start, end) {
          const ret = [];

          if (size < end) {
            end = size;
            start = size - $scope.gap;
          }
          for (let i = start; i < end; i++) {
            ret.push(i);
          }
          return ret;
        };

        $scope.prevPage = function() {
          if ($scope.currentPage > 0) {
            $scope.currentPage--;
          }
        };

        const fetch = async (options = {}) => {
          try {
            const result = await instance.fetch(options);
            items = options.realTime ? result.items.slice(0, 10) : result.items;
            $scope.time = result.time;
            $scope.totalItems = items.length;
            $scope.items = items;
            checkGap();
            $scope.searchTable();
            return;
          } catch (error) {
            return Promise.reject(error);
          }
        };

        $scope.nextPage = async currentPage => {
          try {
            $scope.error = false;
            if (
              !currentPage &&
              $scope.currentPage < $scope.pagedItems.length - 1
            ) {
              $scope.currentPage++;
            }
            if (
              $scope.pagedItems[currentPage || $scope.currentPage].includes(
                null
              )
            ) {
              const copy = $scope.currentPage;
              $scope.wazuh_table_loading = true;
              const currentNonNull = $scope.items.filter(item => !!item);
              await fetch({ offset: currentNonNull.length });
              $scope.wazuh_table_loading = false;
              $scope.currentPage = copy;
              if (!$scope.$$phase) $scope.$digest();
            }
          } catch (error) {
            $scope.wazuh_table_loading = false;
            $scope.error = `Error paginating table - ${error.message ||
              error} - Please refresh your browser.`;
            errorHandler.handle(
              `Error paginating table due to ${error.message || error}`,
              'Data factory'
            );
          }
          return;
        };

        $scope.setPage = function() {
          $scope.currentPage = this.n;
          $scope.nextPage(this.n);
        };
        ////////////////////////////////////

        const instance = new DataFactory(
          apiReq,
          $scope.path,
          $scope.implicitFilter
        );
        $scope.items = [];

        $scope.sort = async field => {
          try {
            $scope.error = false;
            $scope.wazuh_table_loading = true;
            instance.addSorting(field.value || field);
            $scope.sortValue = instance.sortValue;
            $scope.sortDir = instance.sortDir;
            await fetch();
            $scope.wazuh_table_loading = false;
            if (!$scope.$$phase) $scope.$digest();
          } catch (error) {
            $scope.wazuh_table_loading = false;
            $scope.error = `Error sorting table by ${
              field ? field.value : 'undefined'
            } - ${error.message || error} - Please refresh your browser.`;
            errorHandler.handle(
              `Error sorting table by ${
                field ? field.value : 'undefined'
              }. ${error.message || error}`,
              'Data factory'
            );
          }
          return;
        };

        const search = async (term, removeFilters) => {
          try {
            $scope.error = false;
            $scope.wazuh_table_loading = true;
            if (removeFilters) instance.removeFilters();
            instance.addFilter('search', term);
            wzTableFilter.set(instance.filters);
            await fetch();
            $scope.wazuh_table_loading = false;
            if (!$scope.$$phase) $scope.$digest();
          } catch (error) {
            $scope.wazuh_table_loading = false;
            $scope.error = `Error searching - ${error.message ||
              error} - Please refresh your browser.`;
            errorHandler.handle(
              `Error searching. ${error.message || error}`,
              'Data factory'
            );
          }
          return;
        };

        const filter = async filter => {
          try {
            $scope.error = false;
            $scope.wazuh_table_loading = true;
            if (filter.name === 'platform' && instance.path === '/agents') {
              const platform = filter.value.split(' - ')[0];
              const version = filter.value.split(' - ')[1];
              instance.addFilter('os.platform', platform);
              instance.addFilter('os.version', version);
            } else {
              instance.addFilter(filter.name, filter.value);
            }
            wzTableFilter.set(instance.filters);
            await fetch();
            $scope.wazuh_table_loading = false;
            if (!$scope.$$phase) $scope.$digest();
          } catch (error) {
            $scope.wazuh_table_loading = false;
            $scope.error = `Error filtering by ${
              filter ? filter.value : 'undefined'
            } - ${error.message || error} - Please refresh your browser.`;
            errorHandler.handle(
              `Error filtering by ${
                filter ? filter.value : 'undefined'
              }. ${error.message || error}`,
              'Data factory'
            );
          }
          return;
        };

        $scope.$on('wazuhUpdateInstancePath', (event, parameters) => {
          instance.filters = [];
          instance.path = parameters.path;
          return init();
        });

        $scope.$on('wazuhFilter', (event, parameters) => {
          return filter(parameters.filter);
        });

        $scope.$on('wazuhSearch', (event, parameters) => {
          if (
            parameters &&
            parameters.specificPath &&
            !instance.path.includes(parameters.specificPath)
          ) {
            return;
          }
          return search(parameters.term, parameters.removeFilters);
        });

        $scope.$on('wazuhRemoveFilter', (event, parameters) => {
          instance.filters = instance.filters.filter(
            item => item.name !== parameters.filterName
          );
          wzTableFilter.set(instance.filters);
          return init();
        });

        const realTimeFunction = async () => {
          try {
            $scope.error = false;
            while (realTime) {
              await fetch({ realTime: true, limit: 10 });
              if (!$scope.$$phase) $scope.$digest();
              await $timeout(1000);
            }
          } catch (error) {
            realTime = false;
            $scope.error = `Real time feature aborted - ${error.message ||
              error} - Please refresh your browser.`;
            errorHandler.handle(
              `Real time feature aborted. ${error.message || error}`,
              'Data factory'
            );
          }
          return;
        };

        $scope.$on('wazuhPlayRealTime', () => {
          realTime = true;
          return realTimeFunction();
        });

        $scope.$on('wazuhStopRealTime', () => {
          realTime = false;
          return init();
        });

        const checkGap = () => {
          const gap = items.length / $scope.itemsPerPage;
          const gapInteger = parseInt(gap);
          $scope.gap = gap - gapInteger > 0 ? gapInteger + 1 : gapInteger;
          if ($scope.gap > 5) $scope.gap = 5;
        };

        const init = async () => {
          try {
            $scope.error = false;
            $scope.wazuh_table_loading = true;
            await fetch();
            wzTableFilter.set(instance.filters);
            $scope.wazuh_table_loading = false;
            if (!$scope.$$phase) $scope.$digest();
          } catch (error) {
            $scope.wazuh_table_loading = false;
            $scope.error = `Error while init table - ${error.message ||
              error} - Please refresh your browser.`;
            errorHandler.handle(
              `Error while init table. ${error.message || error}`,
              'Data factory'
            );
          }
          return;
        };

        init();

        const splitArray = array => {
          if (Array.isArray(array)) {
            if (!array.length) return false;
            let str = '';
            for (const item of array) str += `${item}, `;
            str = str.substring(0, str.length - 2);
            return str;
          }
          return array;
        };

        const checkIfArray = item =>
          typeof item === 'object' ? splitArray(item) : item == 0 ? '0' : item;

        $scope.$on('$destroy', () => {
          $window.onresize = null;
          realTime = null;
          wzTableFilter.set([]);
        });

        $scope.nonDecoderValue = (key, item) => {
          if (key === 'state' && instance.path.includes('processes')) {
            return ProcessEquivalence[item.state] || 'Unknown';
          }
          return key.value === 'local.ip'
            ? (item.local && item.local.ip
                ? `${item.local.ip}:${item.local.port}`
                : false) || '---'
            : key === 'remote.ip'
              ? (item.remote && item.remote.ip
                  ? `${item.remote.ip}:${item.remote.port}`
                  : false) || '---'
              : key === 'os.name'
                ? (item.os && item.os.name ? item.os.name : false) || '---'
                : key === 'os.version'
                  ? (item.os && item.os.version ? item.os.version : false) ||
                    '---'
                  : checkIfArray(item[key.value || key]) || '---';
        };

        $scope.decoderValue = (key, item) => {
          return key === 'details.program_name' ||
            key.value === 'details.program_name'
            ? (item.details && item.details.program_name
                ? item.details.program_name
                : false) || '---'
            : key === 'details.order' || key.value === 'details.order'
              ? (item.details && item.details.order
                  ? item.details.order
                  : false) || '---'
              : checkIfArray(item[key.value || key]) || '---';
        };
      },
      template
    };
  })
  .service('wzTableFilter', () => {
    const filters = [];
    return {
      set(array) {
        if (Array.isArray(array)) {
          filters.length = 0;
          filters.push(...array);
        }
      },
      get() {
        return filters;
      }
    };
  });
