import React from 'react';
import {graphql, withApollo} from 'react-apollo';
import {fragments, FAKE_HISTORY_QUERY, HISTORY_QUERY} from '../graphql/runs';
import {bindActionCreators} from 'redux';
import {connect} from 'react-redux';
import {filterRuns, sortRuns} from '../util/runhelpers.js';
import {JSONparseNaN} from '../util/jsonnan';
import {MAX_HISTORIES_LOADED} from '../util/constants.js';
import _ from 'lodash';
import * as Query from '../util/query';

export default function withHistoryLoader(WrappedComponent) {
  let HistoryLoader = class extends React.Component {
    constructor(props) {
      super(props);
      this.selectedRuns = {};
    }

    _setup(props, nextProps) {
      // In polling mode we always reload all history data. Note the check below
      // to see if selectedRuns has changed from previous props to now will only
      // be true when the withRunsData loader upstream from us has polled new data
      // (or when some other parameters have changed, which doesn't happen on the
      // dashboard page right now)
      let pollingMode = Query.shouldPoll(nextProps.query);

      if (nextProps.data.selectedRuns !== props.data.selectedRuns) {
        //console.log('SelectionQueryThing willReceiveProps', nextProps);
        let selected = _.fromPairs(
          nextProps.data.selectedRuns
            .slice(0, MAX_HISTORIES_LOADED)
            .map(run => [run.name, run.id]),
        );
        // find set of selected runs that have not been fetched
        //console.log('n selected', _.size(selected));
        let selectedInfo = _.map(selected, (id, name) => {
          // if (this.historyLoadedRuns[id]) {
          //   return {id: id, alreadyLoaded: true};
          // }
          let history = null;
          try {
            let result = nextProps.client.readFragment({
              id,
              fragment: fragments.historyRun,
            });
            //console.log('readFragment history result', result);
            history = result.history;
          } catch (err) {
            //console.log("name doesn't have history", name);
          }
          let loadingHistory = false;
          try {
            let result = nextProps.client.readFragment({
              id,
              fragment: fragments.historyRunLoading,
            });
            //console.log('readFragment historyRunLoading result', result);
            loadingHistory = result.historyLoading;
          } catch (err) {
            //console.log("name doesn't have historyLoading", name);
          }
          return {
            id: id,
            name: name,
            history: history,
            loadingHistory: loadingHistory,
          };
        });
        //console.log('selectedInfo', selectedInfo);
        let numLoaded = selectedInfo.filter(o => o.history || o.loadingHistory)
          .length;
        if (pollingMode || numLoaded < MAX_HISTORIES_LOADED) {
          let toLoad = selectedInfo;
          if (!pollingMode) {
            toLoad = toLoad.filter(o => !(o.history || o.loadingHistory));
          }
          //console.log('toLoad', toLoad);
          if (toLoad.length > 0) {
            for (var load of toLoad) {
              nextProps.client.writeFragment({
                id: load.id,
                fragment: fragments.historyRunLoading,
                data: {historyLoading: true, __typename: 'BucketType'},
              });
            }
            nextProps.client
              .query({
                fetchPolicy: pollingMode ? 'network-only' : 'cache-first',
                query: HISTORY_QUERY,
                variables: {
                  entityName: this.props.query.entity,
                  name: this.props.query.model,
                  bucketIds: toLoad.map(o => o.name),
                },
              })
              .then(result => {
                //console.log('result', result);
                for (var load of toLoad) {
                  nextProps.client.writeFragment({
                    id: load.id,
                    fragment: fragments.historyRunLoading,
                    data: {historyLoading: false, __typename: 'BucketType'},
                  });
                }
              });
          }
        }
        nextProps.client.writeQuery({
          query: FAKE_HISTORY_QUERY,
          variables: {histQueryKey: nextProps.histQueryKey},
          data: {
            model: {
              id: 'fake_history_query_' + nextProps.histQueryKey,
              __typename: 'ModelType',
              buckets: {
                __typename: 'BucketConnectionType',
                edges: selectedInfo.map(o => ({
                  node: {
                    id: o.id,
                    name: o.name,
                    history: o.history,
                    __typename: 'BucketType',
                  },
                  __typename: 'BucketTypeEdge',
                })),
              },
            },
          },
        });
      }
    }

    componentWillMount() {
      this.historyLoadedRuns = {};
      this._setup({data: {}}, this.props);
    }

    componentWillReceiveProps(nextProps) {
      this._setup(this.props, nextProps);
    }

    render() {
      return (
        <WrappedComponent {...this.props} selectedRuns={this.selectedRuns} />
      );
    }
  };

  const withData = graphql(FAKE_HISTORY_QUERY, {
    skip: ({query}) => !Query.needsOwnQuery(query),
    options: ({histQueryKey}) => {
      return {
        fetchPolicy: 'cache-only',
        variables: {
          histQueryKey: histQueryKey,
        },
      };
    },
    props: ({data, errors}) => ({
      historyBuckets: (data.model && data.model.buckets) || {edges: []},
    }),
  });

  return withApollo(withData(HistoryLoader));
}