import rison from 'rison-node';
import FilterBarQueryFilterProvider from 'ui/filter_bar/query_filter';
import UtilsBrushEventProvider from 'ui/utils/brush_event';
import FilterBarFilterBarClickHandlerProvider from 'ui/filter_bar/filter_bar_click_handler';

var app = require('ui/modules').get('app/wazuh', [])
  .directive('kbnVis', [function () {
    return {
		restrict: 'E',
		scope: {
		  visIndexPattern: '@visIndexPattern',
		  visA: '@visA',
		  visG: '@visG',
		  visFilter: '@visFilter',
		  visId: '@visId',
		  visHeight: '@visHeight',
		  visWidth: '@visWidth',
		  visSearchable: '@visSearchable',
		  visClickable: '@visClickable'
		},
		template: require('../templates/directives/kibana-visualization-template.html')
    }
  }]).directive('kbnVisValue', [function () {
    return {
		restrict: 'E',
		scope: {
		  visIndexPattern: '@visIndexPattern',
		  visA: '@visA',
		  visG: '@visG',
		  visFilter: '@visFilter',
		  visHeight: '@visHeight',
		  visWidth: '@visWidth',
		  visSearchable: '@visSearchable',
		  visClickable: '@visClickable'
		},
		template: require('../templates/directives/kibana-visualization-value-template.html')
    }
  }]);


require('ui/modules').get('app/wazuh', []).controller('VisController', function ($scope, $route, timefilter, AppState, appState, $location, kbnUrl, $timeout, courier, Private, Promise, savedVisualizations, SavedVis, getAppState, $rootScope) {


	if(typeof $rootScope.visCounter === "undefined")
		$rootScope.visCounter = 0;



	// Set filters
	$scope.filter = {};
	$scope.defaultManagerName = appState.getDefaultManager().name;
	$scope.filter.raw = $scope.visFilter + " AND host: " + $scope.defaultManagerName;
	$scope.filter.current = $scope.filter.raw;

	// Initialize and decode params
	var visState = {};
	var visDecoded = rison.decode($scope.visA);
	
	// Initialize Visualization
	$scope.newVis = new SavedVis({ 'type': visDecoded.vis.type, 'indexPattern': $scope.visIndexPattern });

	$scope.newVis.init().then(function () {
		// Render visualization
		$rootScope.visCounter++;
		renderVisualization();
	},function () {
		console.log("Error: Could not load visualization: "+visDecoded.vis.title);
	});

    function renderVisualization() {

		$scope.loadBeforeShow = false;

		// Set default time
		if($route.current.params._g == "()"){
			timefilter.time.from = "now-24h";
			timefilter.time.to = "now";
		}

		// Initialize time
		$scope.timefilter = timefilter;

		// Get App State
		const $state = getAppState();
		//let $state = new AppState();

		// Initialize queryFilter and searchSource
		$scope.queryFilter = Private(FilterBarQueryFilterProvider);
		$scope.searchSource = $scope.newVis.searchSource;
		courier.setRootSearchSource($scope.searchSource);
		const brushEvent = Private(UtilsBrushEventProvider);
		const filterBarClickHandler = Private(FilterBarFilterBarClickHandlerProvider);
		var agg_fields = [];
		$timeout(
		function() {

		
			// Bind visualization, index pattern and state
			$scope.vis = $scope.newVis.vis;
			$scope.indexPattern = $scope.vis.indexPattern;
			angular.forEach($scope.indexPattern.fields, function(value, key) {
				if(value.aggregatable)
					agg_fields.push(value.displayName);
			});

			$scope.state = $state;

			// Check if needed fields are agreggable
			$scope.not_aggregable = false;
			angular.forEach(visDecoded.vis.aggs, function(value, key) {
				if(value.type == "terms" && (agg_fields.indexOf(value.params.field) === -1)){
					$scope.not_aggregable = true;
					return;
				}
			});

			
			// Build visualization
			visState.aggs = visDecoded.vis.aggs;
			visState.title = visDecoded.vis.title;
			visState.params = visDecoded.vis.params;
			if($scope.visClickable != "false")
				visState.listeners = {brush: brushEvent, click: filterBarClickHandler($state)};


			// Set Vis states
			$scope.uiState = $state.makeStateful('uiState');

			// Hide legend if needed
			if(typeof visDecoded.uiState.vis !== "undefined" && typeof visDecoded.uiState.vis.legendOpen !== "undefined" && !visDecoded.uiState.vis.legendOpen)
				$scope.uiState.set('vis.legendOpen', false);
			else
				$scope.uiState.set('vis.legendOpen', true);

			if($scope.not_aggregable){
				$rootScope.visCounter--;
				return;
			}
			
			$scope.vis.setUiState($scope.uiState);
			$scope.vis.setState(visState);
			$rootScope.visCounter--;
			$scope.loadBeforeShow = true;


		}, 0);


		// Fetch visualization
		$scope.fetch = function ()
		{

			if($scope.visIndexPattern == "wazuh-alerts-*"){
				$scope.searchSource.set('filter', $scope.queryFilter.getFilters());
				$scope.searchSource.set('query', $scope.filter.current);
			}
			if ($scope.vis && $scope.vis.type.requiresSearch) {
				$state.save();
				courier.fetch();
			}

		};


		// Listeners

		// Listen for timefilter changes
		$scope.$listen(timefilter, 'fetch', function () {
			$scope.fetch();
        });

		// Listen for filter changes
		$scope.$listen($scope.queryFilter, 'update', function () {
			$scope.fetch();
		 });

		// Listen for query changes
		var updateQueryWatch = $rootScope.$on('updateQuery', function (event, query) {
			if(query !== "undefined" && !$scope.not_aggregable){
				$scope.filter.current.query_string.query = $scope.filter.raw+" AND "+query.query_string.query;
				$scope.fetch();
			}
		 });

		// Listen for visualization queue prepared
		var fetchVisualizationWatch = $rootScope.$on('fetchVisualization', function (event) {
				$scope.fetch();
		 });

		// Watcher
		var visFilterWatch = $scope.$watch("visFilter", function () {
			$scope.filter.raw = $scope.visFilter + " AND host: " + $scope.defaultManagerName;
			$scope.filter.current = $scope.filter.raw;
			$scope.fetch();
		});		
		 
		// Destroy
		$scope.$on('$destroy', function () {
			$scope.newVis.destroy();
		});
		
		$scope.$on('$destroy', updateQueryWatch);
		$scope.$on('$destroy', fetchVisualizationWatch);
		$scope.$on('$destroy', visFilterWatch);

    };

  });