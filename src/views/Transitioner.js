import React from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing } from 'react-native-reanimated';
import invariant from '../utils/invariant';

import NavigationScenesReducer from './ScenesReducer';
const { block, call, Value } = Animated;

// Used for all animations unless overriden
const DefaultTransitionSpec = {
  duration: 250,
  easing: Easing.inOut(Easing.ease),
  timing: Animated.timing,
};

class Transitioner extends React.Component {
  constructor(props, context) {
    super(props, context);

    // The initial layout isn't measured. Measured layout will be only available
    // when the component is mounted.
    const layout = {
      height: new Value(0),
      initHeight: 0,
      initWidth: 0,
      isMeasured: false,
      width: new Value(0),
    };

    const position = new Value(this.props.navigation.state.index);

    this.state = {
      layout,
      position,
      scenes: NavigationScenesReducer(
        [],
        this.props.navigation.state,
        null,
        this.props.descriptors
      ),
    };

    this._prevTransitionProps = null;
    this._transitionProps = buildTransitionProps(props, this.state);
    this._isMounted = false;
    this._isTransitionRunning = false;
    this._queuedTransition = null;
  }

  componentDidMount() {
    this._isMounted = true;
  }

  componentWillUnmount() {
    this._isMounted = false;
  }

  // eslint-disable-next-line react/no-deprecated
  componentWillReceiveProps(nextProps) {
    let nextScenes = NavigationScenesReducer(
      this.state.scenes,
      nextProps.navigation.state,
      this.props.navigation.state,
      nextProps.descriptors
    );
    if (!nextProps.navigation.state.isTransitioning) {
      nextScenes = filterStale(nextScenes);
    }

    // Update nextScenes when we change screenProps
    // This is a workaround for https://github.com/react-navigation/react-navigation/issues/4271
    if (nextProps.screenProps !== this.props.screenProps) {
      this.setState({ nextScenes });
    }

    if (nextScenes === this.state.scenes) {
      return;
    }

    const indexHasChanged =
      nextProps.navigation.state.index !== this.props.navigation.state.index;
    if (this._isTransitionRunning) {
      this._queuedTransition = { nextProps, nextScenes, indexHasChanged };
      return;
    }

    this._startTransition(nextProps, nextScenes, indexHasChanged);
  }

  _startTransition(nextProps, nextScenes, indexHasChanged) {
    const nextState = {
      ...this.state,
      scenes: nextScenes,
    };

    const { position } = nextState;

    this._prevTransitionProps = this._transitionProps;
    this._transitionProps = buildTransitionProps(nextProps, nextState);

    const toValue = nextProps.navigation.state.index;

    if (!this._transitionProps.navigation.state.isTransitioning) {
      this.setState(nextState, async () => {
        const result = nextProps.onTransitionStart(
          this._transitionProps,
          this._prevTransitionProps
        );
        if (result instanceof Promise) {
          await result;
        }
        position.setValue(toValue);
        this._onTransitionEnd();
      });
      return;
    }

    // get the transition spec.
    const transitionUserSpec = nextProps.configureTransition
      ? nextProps.configureTransition(
          this._transitionProps,
          this._prevTransitionProps
        )
      : null;

    const transitionSpec = {
      ...DefaultTransitionSpec,
      ...transitionUserSpec,
    };

    const { timing } = transitionSpec;
    delete transitionSpec.timing;

    // update scenes and play the transition
    this._isTransitionRunning = true;
    this.setState(nextState, async () => {
      if (nextProps.onTransitionStart) {
        const result = nextProps.onTransitionStart(
          this._transitionProps,
          this._prevTransitionProps
        );

        if (result instanceof Promise) {
          await result;
        }
      }

      // const positionHasChanged = position.__getValue() !== toValue;
      // if swiped back, indexHasChanged == true && positionHasChanged == false
      if (indexHasChanged) {
        timing(position, { ...transitionSpec,
          toValue: nextProps.navigation.state.index,
        }).start(this._onTransitionEnd);
      }
    });
  }

  render() {
    return (
      <View onLayout={this._onLayout} style={styles.main}>
        {this.props.render(this._transitionProps, this._prevTransitionProps)}
      </View>
    );
  }

  _onLayout = event => {
    const { height, width } = event.nativeEvent.layout;
    if (
      this.state.layout.initWidth === width &&
      this.state.layout.initHeight === height
    ) {
      return;
    }
    const layout = {
      ...this.state.layout,
      initHeight: height,
      initWidth: width,
      isMeasured: true,
    };

    layout.height.setValue(height);
    layout.width.setValue(width);

    const nextState = {
      ...this.state,
      layout,
    };

    this._transitionProps = buildTransitionProps(this.props, nextState);
    this.setState(nextState);
  };

  _onTransitionEnd = () => {
    if (!this._isMounted) {
      return;
    }

    const prevTransitionProps = this._prevTransitionProps;
    this._prevTransitionProps = null;

    const scenes = filterStale(this.state.scenes);

    const nextState = {
      ...this.state,
      scenes,
    };

    this._transitionProps = buildTransitionProps(this.props, nextState);

    this.setState(nextState, async () => {
      if (this.props.onTransitionEnd) {
        const result = this.props.onTransitionEnd(
          this._transitionProps,
          prevTransitionProps
        );

        if (result instanceof Promise) {
          await result;
        }
      }

      if (this._queuedTransition) {
        this._startTransition(
          this._queuedTransition.nextProps,
          this._queuedTransition.nextScenes,
          this._queuedTransition.indexHasChanged
        );
        this._queuedTransition = null;
      } else {
        this._isTransitionRunning = false;
      }
    });
  };
}

function buildTransitionProps(props, state) {
  const { navigation } = props;

  const { layout, position, scenes } = state;

  const scene = scenes.find(isSceneActive);

  invariant(scene, 'Could not find active scene');

  return {
    layout,
    navigation,
    position,
    scenes,
    scene,
    index: scene.index,
  };
}

function isSceneNotStale(scene) {
  return !scene.isStale;
}

function filterStale(scenes) {
  const filtered = scenes.filter(isSceneNotStale);
  if (filtered.length === scenes.length) {
    return scenes;
  }
  return filtered;
}

function isSceneActive(scene) {
  return scene.isActive;
}

const styles = StyleSheet.create({
  main: {
    flex: 1,
  },
});

export default Transitioner;
