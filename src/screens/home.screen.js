define([
    'quark',
    'knockout',
    'text!./home.screen.html'
], function($$, ko, template) {

    function HomeScreen(params, $scope, $imports) {
        var self = this;

        this.name = "Welcome to Test application";
        this.description = "Prueba de Quark";
    }

    return $$.component(HomeScreen, template);
});
