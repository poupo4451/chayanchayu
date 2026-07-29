Component({
  properties: {
    line: {
      type: Object,
      value: {},
    },
  },

  methods: {
    onTap() {
      this.triggerEvent('tap');
    },
  },
});
