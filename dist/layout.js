
define('text!qk-alchemy/components/layout.component.html',[],function () { return '<!-- quark-component -->\r\n    <!-- ko content -->\r\n    <!-- /ko -->\r\n<!-- /ko -->\r\n';});

/**
    @component
    Allows to define the general layout of the page. It coordinates the navbar,
    sidebar and main container and interactions between them.
    <br/>
    For example, this is a layout with a navbar and sidebar
    &lt;quark-component&lt;
        &lt;al-layout&lt;
            &lt;al-layout-sidebar&lt;
            &lt;/al-layout-sidebar&lt;

            &lt;al-layout-container&lt;
            &lt;/al-layout-container&lt;
        &lt;/al-layout&lt;
    &lt;/quark-component&lt;
    @allowContent
*/
define('qk-alchemy/components/layout.component',[
    'quark',
    'knockout',
    'text!./layout.component.html'
], function($$, ko, template) {

    function LayoutComponent(params, $scope, $imports) {
        var self = this;

        /**
            @property bool True if the layout contains a al-layout-navbar component.
            Do not set this property by code.
            @observable
        */
        this.hasNavbar = ko.observable(false);
        /**
            @property bool True if the layout has a al-layout-sidebar component.
            Do not set this property by code.
            @observable
        */
        this.hasSidebar = ko.observable(false);
        /**
            @property bool True if the layout has a al-layout-submenu component.
            Do not set this property by code.
            @observable
        */
        this.hasSubmenu = ko.observable(false);

        $$.parameters({
            /**
                @parameter int sidebar's width in pixels, sidebar's max size is
                half the window
                @observable @exposed
            */
            sidebarSize: ko.observable(90),
            /**
                @parameter string Bootstrap size with the breaking point of the main container.
                When the viewport is less than this size the sidebar breaks above
                the main content.
                @observable @exposed
            */
            containerSize: ko.observable('md'),
            /**
                @parameter int Minimal width of the sidebar in pixels
                @observable @exposed
            */
            minSidebarSize: ko.observable(20),
            /**
                @parameter bool True if the container is fluid
                @observable @exposed
            */
            containerFluid: ko.observable(true)
        }, params, this);

        // On component init
        $imports.initComponent = function() {
            // Validate sidebar size and apply body margin
            validateSize(self.sidebarSize());
            setBodyMargin(self.hasNavbar());
        }

        // Limit sidebar size
        function validateSize() {
            var size = self.sidebarSize();
            var minSize = self.minSidebarSize();
            var maxSize = $(window).width() / 2;

            if ($$.isNumeric(minSize) && minSize > 0 && size < minSize) {
                self.sidebarSize(minSize);
            }

            if (size < 0) {
                self.sidebarSize(0);
            }

            if (size > maxSize) {
                self.sidebarSize(maxSize);
            }
        }

        // Applies the body margin if it has a navbar
        function setBodyMargin(hasNavbar) {
            if (hasNavbar) {
                $(document).css('padding-top', '50px');
            } else {
                $(document).css('padding-top', 'auto');
            }
        }

        var subscriptions = {
            // Validate sidebar size on size change
            sidebarSize: self.sidebarSize.subscribe(validateSize),
            // Validate sidebar size on min size change
            minSidebarSize: self.minSidebarSize.subscribe(validateSize),
            // Apply body margin when hasNavbar changes
            hasNavbar: self.hasNavbar.subscribe(setBodyMargin)
        };

        // Cleans component on dispose
        $scope.dispose = function() {
            subscriptions.sidebarSize.dispose();
            subscriptions.minSidebarSize.dispose();
            subscriptions.hasNavbar.dispose();
        }
    }

    return $$.component(LayoutComponent, template)
})
;
define('text!qk-alchemy/components/layout/container.component.html',[],function () { return '<quark-component>\r\n    <div data-bind="onBind: init,\r\n                    css: classes,\r\n                    style: styles">\r\n        <div data-bind="css: sidebarClass, style: sidebarStyle">\r\n            <!-- ko content -->\r\n            <!-- /ko -->\r\n        </div>\r\n    </div>\r\n</quark-component>\r\n';});

define('qk-alchemy/lib/utils',[
    'quark',
    'knockout'
], function($$, ko) {
    function Utils() {
        var self = this;

        this.findContainer = function(context, type) {
            // Get the context container
            var container = context.$container;

            var found = false;

            if ($$.isArray(type)) {
                for (var i = 0; i < type.length; i++) {
                    var actualType = type[i];

                    if (container instanceof actualType) {
                        found = true;
                        break;
                    }
                }
            } else {
                found = (container instanceof type);
            }

            // If the container exists and is of the requested type return it
            if (found) {
                return container;
            } else {
                // If there's a parent context search for the container type on it
                var parentContext = context.$parentContext;

                if (parentContext) {
                    return self.findContainer(parentContext, type);
                }
            }
        }
    }

    return new Utils();
});

/**
    @component Defines the main content of the page in the layout. It must be used
    inside a al-layout component and it's content will show on the main area of the
    layout. In the al-layout component you can set the <code>containerFluid</code>
    parameter to indicate that this component must use a <code>container</code>
    or <code>container-fluid</code> class.
    @allowContent
*/
define('qk-alchemy/components/layout/container.component',[
    'knockout',
    'quark',
    'text!./container.component.html',
    '../../lib/utils',
    '../layout.component'
], function(ko, $$, template, utils, LayoutComponent) {

    function LayoutContainerComponent(params, $scope, $imports) {
        var self = this;

        // The page has navbar
        var hasNavbar = ko.observable();
        // The page has sidebar
        var hasSidebar = ko.observable();
        // The page has submenu
        var hasSubmenu = ko.observable();

        // Layout values that can be overriden by parameters
        var layout = {
            // Stores the sidebar size observable of the layout component
            sidebarSize: ko.observable(),
            // Stores the container size observable of the layout component
            containerSize: ko.observable(),
            // Is container fluid?
            containerFluid: ko.observable(),
        };

        // When binding the main div
        $scope.init = function(element, viewModel, context) {
            // Get the main layout component
            var layoutMain = utils.findContainer(context, LayoutComponent.modelType);

            // If a main layout is defined
            if (layoutMain) {
                // Copy main layout component observables to local variables
                hasNavbar = layoutMain.hasNavbar;
                hasSidebar = layoutMain.hasSidebar;
                hasSubmenu = layoutMain.hasSubmenu;
                layout.sidebarSize = layoutMain.sidebarSize;
                layout.containerSize = layoutMain.containerSize;
                layout.containerFluid = layoutMain.containerFluid;

                // Inject values specified in local parameters
                $$.inject(params, layout);

                // Publish properties of the layout as local properties of this model
                self.containerSize = layout.containerSize;
                self.containerFluid = layout.containerFluid;
            } else {
                throw Error('The al-layout-container component must be used inside an al-layout component');
            }
        }

        $scope.styles = ko.pureComputed(function() {
            var styles = {};

            styles.paddingTop = 0;

            if (hasNavbar()) {
                styles.paddingTop += 50;
            }

            if (hasSubmenu()) {
                styles.paddingTop += 40;
            }

            styles.paddingTop += "px";

            return styles;
        })

        $scope.sidebarStyle = ko.pureComputed(function() {
            var styles = {};

            if (hasSidebar()) {
                styles.paddingLeft = layout.sidebarSize();

                if (layout.containerFluid()) {
                    styles.paddingLeft += 15;
                }

                styles.paddingLeft += "px";
            }

            return styles;
        });

        // Clases que se deben aplicar al elemento para que se muestre como corresponde.
        $scope.classes = ko.pureComputed(function() {
            var res = "container";

            if (layout.containerFluid()) {
                res += "-fluid";
            }

            return res;
        });

        // Clases que se deben aplicar al elemento para que se muestre como corresponde.
        $scope.sidebarClass = ko.pureComputed(function() {
            if (hasSidebar()) {
                return "with-sidebar-col-" + layout.containerSize();
            }

            return "";
        });

    }

    return $$.component(LayoutContainerComponent, template);
});
